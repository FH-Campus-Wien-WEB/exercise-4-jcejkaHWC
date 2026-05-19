const express = require("express");
const path = require("path");
const bodyParser = require("body-parser");
const session = require("express-session");
const bcrypt = require("bcrypt");
const config = require("./config.js");
const movieModel = require("./movie-model.js");
const userModel = require("./user-model.js");

const app = express();

// Parse JSON bodies
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

// ==========================================
// POST /login: Verarbeitet die Login-Daten
// ==========================================
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
// TASK 1.3: GET /logout
// ==========================================
app.get("/logout", function (req, res) {
  req.session.destroy(function (err) {
    if (err) {
      res.sendStatus(500);
    } else {
      res.sendStatus(200);
    }
  });
});

// ==========================================
// GET /session: Liefert die aktuelle Session
// ==========================================
app.get("/session", function (req, res) {
  if (req.session && req.session.user) {
    res.send(req.session.user);
  } else {
    res.sendStatus(401);
  }
});

// ==========================================
// GET /movies: Alle Filme des Users auflisten
// ==========================================
app.get("/movies", requireLogin, function (req, res) {
  const username = req.session.user.username;
  const genre = req.query.genre;
  const userMovies = Object.values(movieModel.getUserMovies(username));

  if (genre) {
    const filteredMovies = userMovies.filter(movie => 
      movie.Genres && movie.Genres.includes(genre)
    );
    res.send(filteredMovies);
  } else {
    res.send(userMovies);
  }
});

// ==========================================
// GET /movies/:imdbID: Einzelnen Film holen
// ==========================================
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
    const url = `http://www.omdbapi.com/?i=${encodeURIComponent(imdbID)}&apikey=${config.omdbApiKey}`;
    
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), config.omdbTimeoutMs);

    fetch(url, { signal: controller.signal })
      .then(apiRes => {
        clearTimeout(timeoutId);
        if (!apiRes.ok) {
          res.sendStatus(apiRes.status);
          return null;
        }
        return apiRes.json();
      })
      .then(omdbMovie => {
        if (!omdbMovie) return; 

        // OMDb antwortet bei Fehlern mit dem String "False"
        if (omdbMovie.Response === "False") {
          return res.sendStatus(404);
        }

        const parseCSV = (str) => str && str !== "N/A" ? str.split(",").map(s => s.trim()) : [];

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
        return res.sendStatus(201); // 201 Created für erfolgreiches Hinzufügen
      })
      .catch(err => {
        clearTimeout(timeoutId);
        if (!res.headersSent) {
          if (err.name === 'AbortError') {
            return res.sendStatus(504);
          }
          console.error("Fehler beim PUT-Fetch:", err);
          return res.sendStatus(500);
        }
      });
  } else {
    movieModel.setUserMovie(username, imdbID, req.body);
    return res.sendStatus(200);
  }
});

// ==========================================
// GET /search: Filme über OMDb suchen
// ==========================================
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
        res.sendStatus(apiRes.status);
        return null;
      }
      return apiRes.json();
    })
    .then(response => {
      if (!response) return;

      // OMDb antwortet bei Erfolg mit dem String "True"
      if (response.Response === 'True') {
        const results = response.Search
          .filter(movie => !movieModel.hasUserMovie(username, movie.imdbID))
          .map(movie => ({
            Title: movie.Title,
            imdbID: movie.imdbID,
            Year: isNaN(movie.Year) ? null : parseInt(movie.Year)
          }));
        return res.send(results);
      } else {
        return res.send([]); // Leeres Array senden, wenn nichts gefunden wurde
      }
    })
    .catch((err) => {
      clearTimeout(timeoutId);
      if (!res.headersSent) {
        if (err.name === 'AbortError') {
          return res.sendStatus(504);
        }
        console.error("Fehler beim Search-Fetch:", err);
        return res.sendStatus(500);
      }
    });
});

// ==========================================
// DELETE /movies/:imdbID: Film löschen
// ==========================================
app.delete("/movies/:imdbID", requireLogin, function (req, res) {
  const username = req.session.user.username;
  const id = req.params.imdbID;
  if (movieModel.deleteUserMovie(username, id)) {
    res.sendStatus(200);
  } else {
    res.sendStatus(404);
  }
});

// ==========================================
// GET /genres: Alle Genres des Users holen
// ==========================================
app.get("/genres", requireLogin, function (req, res) {
  const username = req.session.user.username;
  res.send(movieModel.getGenres(username));
});

// Server starten
const port = config.port;
app.listen(port, () => {
  console.log(`Server now listening on http://localhost:${port}/`);
});