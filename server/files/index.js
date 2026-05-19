import { ButtonBuilder, ElementBuilder, MovieBuilder } from "./builders.js";

// Externalized message strings
const messages = {
  dataLoadError: 'Daten konnten nicht geladen werden, Status',
  movieAlreadyInCollection: 'Film bereits in der Sammlung.',
  addMovieFailed: 'Hinzufügen des Films ist fehlgeschlagen.',
  deleteMovieFailed: 'Film konnte nicht gelöscht werden.',
  noResultsFound: 'Keine Ergebnisse gefunden.',
  searchFailed: 'Die Suche ist fehlgeschlagen...',
  loggedOutGreeting: 'Bitte logge dich ein, um deine Filmkollektion zu sehen.',
  loginFailed: 'Login failed'
};

let currentSession = null;

function updateGenres() {
  const header = document.querySelector('nav>h2');
  const listElement = document.querySelector("#filter");

  listElement.innerHTML = '';

  if (!currentSession) {
    header.style.display = 'none';
    return;
  }

  fetch("/genres")
    .then(response => {
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      return response.json();
    })
    .then(genres => {
      header.style.display = 'block';
      new ElementBuilder("li").append(new ButtonBuilder("All").onclick(() => loadMovies()))
        .appendTo(listElement);

      for (const genre of genres) {
        new ElementBuilder("li").append(new ButtonBuilder(genre).onclick(() => loadMovies(genre)))
          .appendTo(listElement);
      }
    })
    .catch(error => {
      console.error("Fehler beim Laden der Genres:", error);
    });
}

function loadMovies(genre) {
  const main = document.querySelector("main");
  main.innerHTML = '';

  let url = "/movies";
  if (genre) {
    url += "?genre=" + encodeURIComponent(genre);
  }

  fetch(url)
    .then(response => {
      if (!response.ok) {
        throw new Error(`${messages.dataLoadError} ${response.status}`);
      }
      return response.json();
    })
    .then(movies => {
      for (const movie of movies) {
        // Nutzt den vorgegebenen MovieBuilder aus builders.js
        new MovieBuilder(movie, deleteMovie, currentSession !== null).appendTo(main);
      }
    })
    .catch(error => {
      main.textContent = error.message;
    });
}

function deleteMovie(imdbID) {
  fetch("/movies/" + encodeURIComponent(imdbID), {
    method: "DELETE"
  })
  .then(response => {
    if (!response.ok) {
      alert(messages.deleteMovieFailed);
    } else {
      loadMovies();
      updateGenres();
    }
  })
  .catch(() => alert(messages.deleteMovieFailed));
}

// =========================================================================
// TASK 2.2: Suchergebnisse verarbeiten und rendern 
// =========================================================================
function searchMovies(query) {
  const resultsContainer = document.getElementById("searchResults");
  resultsContainer.innerHTML = ''; // Vorherige Suche leeren

  fetch("/search?query=" + encodeURIComponent(query))
    .then(response => {
      if (!response.ok) throw new Error();
      return response.json();
    })
    .then(movies => {
      // Wenn das Array leer ist, zeigen wir die vordefinierte Fehlermeldung
      if (movies.length === 0) {
        new ElementBuilder("p").text(messages.noResultsFound).appendTo(resultsContainer);
        return;
      }

      // Einträge über ElementBuilder / ButtonBuilder zusammenbauen
      movies.forEach(movie => {
        const row = new ElementBuilder("div").class("search-result-row");
        row.element.style.display = "flex";
        row.element.style.justifyContent = "space-between";
        row.element.style.marginBottom = "8px";

        const textSpan = new ElementBuilder("span")
          .text(`${movie.Title} (${movie.Year || 'N/A'})`);
        
        const addBtn = new ButtonBuilder("Add").onclick((e) => {
          if (e && typeof e.preventDefault === 'function') {
            e.preventDefault(); // Verhindert, dass der Button das Suchfenster absendet/einfriert
          }
          addMovie(movie.imdbID, row.element);
        });

        row.append(textSpan).append(addBtn).appendTo(resultsContainer);
      });
    })
    .catch(() => {
      new ElementBuilder("p").text(messages.searchFailed).appendTo(resultsContainer);
    });
}

function addMovie(imdbID, rowElement) {
  fetch("/movies/" + encodeURIComponent(imdbID), {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({})
  })
  .then(response => {
    if (response.ok || response.status === 201) {
      // 1. Entferne SOFORT die Zeile aus dem Suchfenster
      rowElement.remove();
      
      
      setTimeout(() => {
        loadMovies();
        updateGenres();
        
        // Zwinge den Fokus zurück auf das Suchfenster/Eingabefeld
        const queryInput = document.getElementById('query');
        if (queryInput) queryInput.focus();
      }, 50);

    } else {
      alert(messages.addMovieFailed);
    }
  })
  .catch(() => alert(messages.addMovieFailed));
}

// =========================================================================
// TASK 1.2 & 1.3: UI Anpassungen (Login/Logout Zustand)
// =========================================================================
function updateUI() {
  const userGreeting = document.getElementById('userGreeting');
  const authBtn = document.getElementById('authBtn');
  const addMoviesBtn = document.getElementById('addMoviesBtn');

  if (currentSession) {
    // TASK 1.2: Deutsches Datums- und Uhrzeitformat generieren
    const loginDate = new Date(currentSession.loginTime);
    const dateStr = loginDate.toLocaleDateString("de-DE", { day: "numeric", month: "long", year: "numeric" });
    const timeStr = loginDate.toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit" });

    userGreeting.textContent = `Hi ${currentSession.firstName} ${currentSession.lastName}, du hast dich am ${dateStr} um ${timeStr} angemeldet.`;

    // TASK 1.3: Logout-Logik zuweisen
    authBtn.textContent = 'Logout';
    authBtn.onclick = () => {
      fetch("/logout")
        .then(() => {
          currentSession = null;
          updateUI();
          updateGenres();
          const main = document.querySelector("main");
          main.innerHTML = '';
          new ElementBuilder("p").text(messages.loggedOutGreeting).appendTo(main);
        });
    };
    addMoviesBtn.style.display = 'inline-block';
  } else {
    // Zustand wenn ausgeloggt
    userGreeting.textContent = '';
    authBtn.textContent = 'Login';
    authBtn.onclick = () => {
      const loginForm = document.getElementById('loginForm');
      loginForm.reset();
      document.getElementById('loginError').textContent = '';
      document.getElementById('loginDialog').showModal();
    };
    addMoviesBtn.style.display = 'none';
  }
}

// =========================================================================
// App-Initialisierung und Event-Listener
// =========================================================================
window.addEventListener("DOMContentLoaded", () => {
  const main = document.querySelector("main");
  
  // Beim ersten Laden prüfen, ob noch eine aktive Session existiert
  fetch("/session")
    .then(res => res.ok ? res.json() : null)
    .then(sessionData => {
      currentSession = sessionData;
      updateUI();
      updateGenres();
      if (currentSession) {
        loadMovies();
      } else {
        new ElementBuilder("p").text(messages.loggedOutGreeting).appendTo(main);
      }
    });

  // TASK 1.1: Login Form-Submission verarbeiten via FormData
  document.getElementById('loginForm').addEventListener('submit', (e) => {
    e.preventDefault();
    const formData = new FormData(e.target);
    const data = Object.fromEntries(formData); // Macht ein einfaches JS-Objekt daraus

    fetch("/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data)
    })
    .then(res => {
      if (!res.ok) throw new Error();
      return res.json();
    })
    .then(sessionData => {
      currentSession = sessionData;
      document.getElementById('loginDialog').close();
      updateUI();
      updateGenres();
      loadMovies();
    })
    .catch(() => {
      // Zeigt die Fehlermeldung direkt im Login-Modal an
      document.getElementById('loginError').textContent = messages.loginFailed;
    });
  });

  document.getElementById('cancelLogin').addEventListener('click', () => {
    document.getElementById('loginDialog').close();
  });

  // Search Dialog Öffnen-Handler
  document.getElementById('addMoviesBtn').addEventListener('click', () => {
    const searchForm = document.getElementById('searchForm');
    searchForm.reset();
    document.getElementById('searchResults').innerHTML = '';
    document.getElementById('searchDialog').showModal();
  });

  document.getElementById('searchForm').addEventListener('submit', (e) => {
    e.preventDefault();
    const query = document.getElementById('query').value;
    searchMovies(query);
  });

  document.getElementById('cancelSearch').addEventListener('click', () => {
    document.getElementById('searchDialog').close();
  });
});