const express = require("express");
const path = require("path");
const bodyParser = require("body-parser");
const session = require("express-session");
const bcrypt = require("bcrypt");
const config = require("./config.js");
const movieModel = require("./movie-model.js");
const userModel = require("./user-model.js");

const app = express();

// Parse urlencoded bodies
app.use(bodyParser.json());

// Session middleware
app.use(session({
  secret: config.sessionSecret,
  resave: false,
  saveUninitialized: true,
  cookie: { secure: false } // Set to true if using HTTPS
}));

// Serve static content in directory 'files'
app.use(express.static(path.join(__dirname, "files")));

// =========================================================================
// AB HIER ERSETZEN / EINFÜGEN
// =========================================================================

// ==========================================
// TASK 1.3: requireLogin Middleware
// ==========================================
function requireLogin(req, res, next) {
  if (req.session && req.session.user) {
    next(); // Benutzer ist eingeloggt -> weiter zur Route
  } else {
    res.sendStatus(401); // Nicht autorisiert
  }
}

// POST /login: Verarbeitet die Login-Daten
app.post("/login", function (req, res) {
  const { username, password } = req.body;
  const user = userModel[username];
  if (user && bcrypt.compareSync(password, user.password)) {
    req.session.user = {
      username,
      firstName: user.firstName,
      lastName: user.lastName,
      loginTime: new Date().toISOString(),
    };
    res.send(req.session.user);
  } else {
    res.sendStatus(401);
  }
});

// ==========================================
// TASK 1.3: GET /logout Endpoint
// ==========================================
app.get("/logout", function (req, res) {
  req.session.destroy(function (err) {
    if (err) {
      console.error("Logout Fehler:", err);
      return res.sendStatus(500);
    }
    res.sendStatus(200);
  });
});

// GET /session: Gibt die aktuelle Session zurück, falls vorhanden
app.get("/session", function (req, res) {
  if (req.session.user) {
    res.send(req.session.user);
  } else {
    res.status(401).json(null);
  }
});

// =========================================================================
// AB HIER SIND ALLE ROUTEN DURCH 'requireLogin' GESCHÜTZT
// =========================================================================

app.get("/movies", requireLogin, function (req, res) {
  const username = req.session.user.username;
  let movies = Object.values(movieModel.getUserMovies(username));
  const queriedGenre = req.query.genre;
  if (queriedGenre) {
    movies = movies.filter((movie) => movie.Genres.indexOf(queriedGenre) >= 0);
  }
  res.send(movies);
});

app.get("/movies/:imdbID", requireLogin, function (req, res) {
  const username = req.session.user.username;
  const id = req.params.imdbID;
  const movie = movieModel.getUserMovie(username, id);

  if (movie) {
    res.send(movie);
  } else {
    res.sendStatus(404);
  }
});

// ==========================================
// TASK 2.3: PUT /movies/:imdbID mit OMDb-Fetch
// ==========================================
app.put("/movies/:imdbID", requireLogin, function (req, res) {
  const username = req.session.user.username;
  const imdbID = req.params.imdbID;
  const exists = movieModel.getUserMovie(username, imdbID) !== undefined;

  if (!exists) {
    // Wenn der Film noch nicht existiert, holen wir die Daten von OMDb
    const url = `http://www.omdbapi.com/?i=${encodeURIComponent(imdbID)}&apikey=${config.omdbApiKey}`;
    
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), config.omdbTimeoutMs);

    fetch(url, { signal: controller.signal })
      .then(apiRes => {
        clearTimeout(timeoutId);
        if (!apiRes.ok) {
          return res.sendStatus(apiRes.status);
        }
        return apiRes.json();
      })
      .then(omdbMovie => {
        if (!omdbMovie || omdbMovie.Response === "False") {
          return res.sendStatus(404);
        }

        // Hilfsfunktion zum sauberen Konvertieren von Komma-Strings in Arrays
        const parseCSV = (str) => str && str !== "N/A" ? str.split(",").map(s => s.trim()) : [];

        // Exakte Konvertierung in das interne Format (wichtig für das korrekte Rendering!)
        const convertedMovie = {
          imdbID: omdbMovie.imdbID,
          Title: omdbMovie.Title,
          Released: (omdbMovie.Released && omdbMovie.Released !== "N/A") ? new Date(omdbMovie.Released).toISOString().split('T')[0] : null,
          Runtime: (omdbMovie.Runtime && omdbMovie.Runtime !== "N/A") ? parseInt(omdbMovie.Runtime) : null,
          Genres: parseCSV(omdbMovie.Genre),
          Directors: parseCSV(omdbMovie.Director),
          Writers: parseCSV(omdbMovie.Writer),
          Actors: parseCSV(omdbMovie.Actor),
          Plot: omdbMovie.Plot !== "N/A" ? omdbMovie.Plot : "",
          Poster: omdbMovie.Poster !== "N/A" ? omdbMovie.Poster : "",
          Metascore: (omdbMovie.Metascore && omdbMovie.Metascore !== "N/A") ? parseInt(omdbMovie.Metascore) : null,
          imdbRating: (omdbMovie.imdbRating && omdbMovie.imdbRating !== "N/A") ? parseFloat(omdbMovie.imdbRating) : null
        };

        movieModel.setUserMovie(username, imdbID, convertedMovie);
        res.sendStatus(201); // 201 Created für neu erstellte Filme
      })
      .catch(err => {
        clearTimeout(timeoutId);
        if (err.name === 'AbortError') {
          return res.sendStatus(504);
        }
        res.sendStatus(500);
      });
  } else {
    // Wenn der Film schon da ist (z.B. Bearbeitung über edit.html), updaten wir ihn einfach mit dem Body
    movieModel.setUserMovie(username, imdbID, req.body);
    res.sendStatus(200);
  }
});

app.delete("/movies/:imdbID", requireLogin, function (req, res) {
  const username = req.session.user.username;
  const id = req.params.imdbID;
  if (movieModel.deleteUserMovie(username, id)) {
    res.sendStatus(200);
  } else {
    res.sendStatus(404);
  }
});

app.get("/genres", requireLogin, function (req, res) {
  const username = req.session.user.username;
  const genres = movieModel.getGenres(username);
  genres.sort();
  res.send(genres);
});

app.get("/search", requireLogin, function (req, res) {
  const username = req.session.user.username;
  const query = req.query.query;
  if (!query) {
    return res.sendStatus(400);
  }

  const url = `http://www.omdbapi.com/?s=${encodeURIComponent(query)}&apikey=${config.omdbApiKey}`;

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), config.omdbTimeoutMs);

  fetch(url, { signal: controller.signal })
    .then(apiRes => {
      clearTimeout(timeoutId);
      if (!apiRes.ok) {
        return res.sendStatus(apiRes.status);
      }
      return apiRes.json();
    })
    .then(response => {
      if (response.Response === 'True') {
        const results = response.Search
          .filter(movie => !movieModel.hasUserMovie(username, movie.imdbID))
          .map(movie => ({
            Title: movie.Title,
            imdbID: movie.imdbID,
            Year: isNaN(movie.Year) ? null : parseInt(movie.Year)
          }));
        res.send(results);
      } else {
        res.send([]);
      }
    })
    .catch((err) => {
      clearTimeout(timeoutId);
      if (err.name === 'AbortError') {
        return res.sendStatus(504);
      }
      res.sendStatus(500);
    });
});

// Ganz am Ende bleibt der Server-Port-Listener unverändert:
app.listen(config.port);
console.log(`Server now listening on http://localhost:${config.port}/`);