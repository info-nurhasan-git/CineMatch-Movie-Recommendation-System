import { useCallback, useEffect, useMemo, useState } from 'react'

const PALETTES = [
  ['#ede9fe', '#fbcfe8', '#fbbf24'],
  ['#dbeafe', '#c7d2fe', '#a5f3fc'],
  ['#ffedd5', '#fecdd3', '#fde68a'],
  ['#d1fae5', '#ccfbf1', '#ecfccb'],
  ['#e9d5ff', '#dbeafe', '#fbcfe8'],
  ['#ffe4e6', '#ede9fe', '#fecdd3'],
  ['#cffafe', '#dbeafe', '#e0f2fe'],
  ['#fef3c7', '#fee2e2', '#fef08a'],
]

const api = {
  async get(path) {
    const response = await fetch(path)
    if (!response.ok) throw new Error((await response.json().catch(() => ({}))).error || 'Request failed')
    return response.json()
  },
  async post(path, body) {
    const response = await fetch(path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
    if (!response.ok) throw new Error((await response.json().catch(() => ({}))).error || 'Request failed')
    return response.json()
  },
}

function paletteFor(title = '') {
  let hash = 0
  for (let i = 0; i < title.length; i += 1) hash = (hash * 31 + title.charCodeAt(i)) % 997
  return PALETTES[hash % PALETTES.length]
}

function initials(title = '') {
  return title
    .split(/\s+/)
    .filter((word) => !['the', 'a', 'of', 'and', 'in'].includes(word.toLowerCase()))
    .slice(0, 2)
    .map((word) => word[0])
    .join('')
    .toUpperCase() || title.slice(0, 2).toUpperCase()
}

function Poster({ movie, className = '', children }) {
  const [first, second, third] = paletteFor(movie.title)
  return (
    <div
      className={`poster ${className}`}
      style={{ '--c1': first, '--c2': second, '--c3': third }}
    >
      <div className="poster-glow" />
      <span className="poster-initials">{initials(movie.title)}</span>
      <span className="poster-title">{movie.title}</span>
      {children}
    </div>
  )
}

function MovieCard({ movie, index, isFavorite, onToggleFavorite, onOpen }) {
  return (
    <article className="movie-card" style={{ animationDelay: `${index * 45}ms` }} onClick={() => onOpen(movie)}>
      <div className="card-art">
        <Poster movie={movie} />
        <span className="match-badge">{movie.match != null ? `${movie.match}% match` : '★ pick'}</span>
        <button
          type="button"
          className={`fav-btn ${isFavorite ? 'is-fav' : ''}`}
          aria-label={isFavorite ? 'Remove from my list' : 'Add to my list'}
          onClick={(event) => {
            event.stopPropagation()
            onToggleFavorite(movie.id)
          }}
        >
          {isFavorite ? '♥' : '♡'}
        </button>
      </div>
      <div className="card-body">
        <div className="card-title-row">
          <h3>{movie.title}</h3>
          <span className="rating">★ {Number(movie.rating || 0).toFixed(1)}</span>
        </div>
        <p className="card-meta">{movie.year} · {movie.genres.slice(0, 2).join(' · ')}</p>
        <p className="card-reason">{movie.reason || movie.overview}</p>
      </div>
    </article>
  )
}

function MovieModal({ movie, isFavorite, onToggleFavorite, onClose, onFindSimilar }) {
  useEffect(() => {
    const onKey = (event) => event.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(event) => event.stopPropagation()} role="dialog" aria-modal="true">
        <button type="button" className="modal-close" onClick={onClose} aria-label="Close">×</button>
        <Poster movie={movie} className="modal-poster" />
        <div className="modal-content">
          <span className="eyebrow">{movie.cluster_label || 'Taste cluster'}</span>
          <h2>{movie.title}</h2>
          <div className="modal-meta">
            <span>★ {Number(movie.rating || 0).toFixed(1)}</span>
            <span>{movie.year}</span>
            <span>{movie.genres.join(' · ')}</span>
          </div>
          <p className="modal-overview">{movie.overview}</p>
          <div className="modal-actions">
            <button type="button" className="btn primary" onClick={() => onFindSimilar(movie)}>
              Find similar movies <span>→</span>
            </button>
            <button type="button" className="btn ghost" onClick={() => onToggleFavorite(movie.id)}>
              {isFavorite ? '♥ In my list' : '♡ Add to my list'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

export default function App() {
  const [movies, setMovies] = useState([])
  const [genres, setGenres] = useState([])
  const [health, setHealth] = useState(null)
  const [mode, setMode] = useState('movie')
  const [query, setQuery] = useState('')
  const [suggestions, setSuggestions] = useState([])
  const [selectedMovie, setSelectedMovie] = useState(null)
  const [pickedGenres, setPickedGenres] = useState([])
  const [results, setResults] = useState([])
  const [lastQuery, setLastQuery] = useState(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [favorites, setFavorites] = useState(() => {
    try {
      return JSON.parse(localStorage.getItem('reelmatch-favorites') || '[]')
    } catch {
      return []
    }
  })
  const [showFavorites, setShowFavorites] = useState(false)
  const [activeMovie, setActiveMovie] = useState(null)

  useEffect(() => {
    localStorage.setItem('reelmatch-favorites', JSON.stringify(favorites))
  }, [favorites])

  useEffect(() => {
    let active = true
    ;(async () => {
      try {
        const [movieData, optionData, healthData] = await Promise.all([
          api.get('/api/movies'),
          api.get('/api/options'),
          api.get('/api/health'),
        ])
        if (!active) return
        setMovies(movieData.movies)
        setGenres(optionData.genres)
        setHealth(healthData)
        const initial = movieData.movies.find((movie) => movie.id === 3) || movieData.movies[0]
        if (initial) {
          setSelectedMovie(initial)
          setQuery(initial.title)
        }
      } catch (requestError) {
        if (active) setError(requestError.message)
      }
    })()
    return () => { active = false }
  }, [])

  const runRecommend = useCallback(async (payload) => {
    setLoading(true)
    setError('')
    setShowFavorites(false)
    try {
      const data = await api.post('/api/recommend', { ...payload, limit: 12 })
      setResults(data.results)
      setLastQuery(data)
    } catch (requestError) {
      setError(requestError.message)
      setResults([])
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    if (selectedMovie && mode === 'movie') runRecommend({ movieId: selectedMovie.id })
    // Only react to an explicit movie selection, not to unrelated re-renders.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedMovie])

  useEffect(() => {
    if (mode !== 'movie' || query.trim().length < 2) {
      setSuggestions([])
      return undefined
    }
    const controller = new AbortController()
    fetch(`/api/search?q=${encodeURIComponent(query.trim())}`, { signal: controller.signal })
      .then((response) => response.json())
      .then((data) => setSuggestions(data.results || []))
      .catch(() => setSuggestions([]))
    return () => controller.abort()
  }, [query, mode])

  const toggleFavorite = (id) => {
    setFavorites((current) => (current.includes(id) ? current.filter((item) => item !== id) : [...current, id]))
  }

  const toggleGenre = (genre) => {
    setPickedGenres((current) =>
      current.includes(genre) ? current.filter((item) => item !== genre) : [...current, genre],
    )
  }

  const favoriteMovies = useMemo(
    () => movies.filter((movie) => favorites.includes(movie.id)),
    [movies, favorites],
  )

  return (
    <div className="app">

      <header className="site-header">
        <div className="brand" onClick={() => setShowFavorites(false)}>
          <span className="brand-mark">▶</span>
          <span>reel<span>match</span></span>
        </div>
        <nav>
          <button type="button" className={!showFavorites ? 'active' : ''} onClick={() => setShowFavorites(false)}>Discover</button>
          <button type="button" className={showFavorites ? 'active' : ''} onClick={() => setShowFavorites(true)}>
            My list <span className="nav-count">{favorites.length}</span>
          </button>
          <span className={`status-dot ${health?.status === 'ok' ? 'live' : ''}`} title={health?.status === 'ok' ? 'Model loaded' : 'Connecting'} />
        </nav>
      </header>

      <main>
        <section className="hero">
          <div className="hero-copy">
            <span className="eyebrow"><span className="pulse" /> AI-POWERED DISCOVERY</span>
            <h1>Your next favourite<br /><em>movie</em> is one click away.</h1>
            <p>
              Powered by the K-Means model in <code>movie_kmeans_model.pkl</code>. Pick a film you love
              or choose a mood — ReelMatch finds the titles that share its DNA.
            </p>
            <div className="hero-actions">
              <a className="btn primary" href="#finder">Start discovering <span>→</span></a>
              <button type="button" className="btn ghost" onClick={() => setShowFavorites(true)}>View my list</button>
            </div>
            <div className="stats">
              <div><strong>{health?.movies ?? '—'}</strong><span>movies</span></div>
              <div><strong>{health?.clusters ?? '—'}</strong><span>taste clusters</span></div>
              <div><strong>TF-IDF</strong><span>genre embeddings</span></div>
            </div>
          </div>
        </section>

        <section className="finder" id="finder">
          <div className="section-heading">
            <span className="eyebrow">THE FINDER</span>
            <h2>How should we match you?</h2>
          </div>

          <div className="finder-panel">
            <div className="tabs">
              <button type="button" className={mode === 'movie' ? 'active' : ''} onClick={() => setMode('movie')}>🎬 By a movie I love</button>
              <button type="button" className={mode === 'mood' ? 'active' : ''} onClick={() => setMode('mood')}>✨ By mood / genres</button>
            </div>

            {mode === 'movie' ? (
              <div className="finder-body">
                <label className="field-label" htmlFor="movie-search">Search a movie title</label>
                <div className="search-row">
                  <div className="search-wrap">
                    <span className="search-icon">⌕</span>
                    <input
                      id="movie-search"
                      value={query}
                      onChange={(event) => setQuery(event.target.value)}
                      placeholder="Try Inception, Titanic, The Shining..."
                      autoComplete="off"
                    />
                    {suggestions.length > 0 && (
                      <ul className="suggestions">
                        {suggestions.map((movie) => (
                          <li key={movie.id}>
                            <button type="button" onClick={() => { setSelectedMovie(movie); setQuery(movie.title); setSuggestions([]) }}>
                              <span>{movie.title}</span>
                              <small>{movie.year} · ★ {Number(movie.rating || 0).toFixed(1)}</small>
                            </button>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                  <button
                    type="button"
                    className="btn primary"
                    disabled={!selectedMovie || loading}
                    onClick={() => selectedMovie && runRecommend({ title: selectedMovie.title })}
                  >
                    Recommend <span>→</span>
                  </button>
                </div>
                {selectedMovie && (
                  <p className="selected-line">
                    Selected: <strong>{selectedMovie.title}</strong> · {selectedMovie.genres.join(', ')}
                  </p>
                )}
              </div>
            ) : (
              <div className="finder-body">
                <span className="field-label">Pick as many genres as you like</span>
                <div className="genre-grid">
                  {genres.map((genre) => (
                    <button
                      type="button"
                      key={genre}
                      className={`genre-chip ${pickedGenres.includes(genre) ? 'active' : ''}`}
                      onClick={() => toggleGenre(genre)}
                    >
                      {genre}
                    </button>
                  ))}
                </div>
                <div className="mood-actions">
                  <button type="button" className="btn primary" disabled={!pickedGenres.length || loading} onClick={() => runRecommend({ genres: pickedGenres })}>
                    Find my movies <span>→</span>
                  </button>
                  {pickedGenres.length > 0 && <button type="button" className="text-btn" onClick={() => setPickedGenres([])}>Clear selection</button>}
                </div>
              </div>
            )}
          </div>
        </section>

        <section className="results" id="results">
          {showFavorites ? (
            <>
              <div className="section-heading row">
                <div>
                  <span className="eyebrow">YOUR COLLECTION</span>
                  <h2>My list <span className="heading-count">{favoriteMovies.length}</span></h2>
                </div>
                {favoriteMovies.length > 0 && <button type="button" className="text-btn" onClick={() => setFavorites([])}>Clear all</button>}
              </div>
              {favoriteMovies.length ? (
                <div className="movie-grid">
                  {favoriteMovies.map((movie, index) => (
                    <MovieCard key={movie.id} movie={movie} index={index} isFavorite onToggleFavorite={toggleFavorite} onOpen={setActiveMovie} />
                  ))}
                </div>
              ) : (
                <div className="empty-state"><span>♡</span><h3>Nothing saved yet</h3><p>Tap the heart on any movie to keep it here.</p></div>
              )}
            </>
          ) : (
            <>
              <div className="section-heading row">
                <div>
                  <span className="eyebrow">RECOMMENDED FOR YOU</span>
                  <h2>{lastQuery ? lastQuery.description : 'Popular right now'}</h2>
                  {lastQuery && <p className="result-sub">{lastQuery.cluster.label} · {lastQuery.total} matches found</p>}
                </div>
              </div>

              {error && <div className="error-banner">{error}</div>}

              {loading ? (
                <div className="movie-grid skeleton-grid">
                  {Array.from({ length: 6 }).map((_, index) => <div key={index} className="skeleton" />)}
                </div>
              ) : results.length ? (
                <div className="movie-grid">
                  {results.map((movie, index) => (
                    <MovieCard
                      key={movie.id}
                      movie={movie}
                      index={index}
                      isFavorite={favorites.includes(movie.id)}
                      onToggleFavorite={toggleFavorite}
                      onOpen={setActiveMovie}
                    />
                  ))}
                </div>
              ) : (
                <div className="empty-state"><span>✦</span><h3>No matches yet</h3><p>Choose a movie or a few genres above to get started.</p></div>
              )}
            </>
          )}
        </section>
      </main>

      <footer>
        <div className="brand small"><span className="brand-mark">▶</span> reel<span>match</span></div>
        <p>Built with React + Flask and your trained K-Means pickle model.</p>
        <p className="footer-note">TF-IDF on MovieLens-style genre strings · cosine similarity ranking</p>
      </footer>

      {activeMovie && (
        <MovieModal
          movie={activeMovie}
          isFavorite={favorites.includes(activeMovie.id)}
          onToggleFavorite={toggleFavorite}
          onClose={() => setActiveMovie(null)}
          onFindSimilar={(movie) => {
            setActiveMovie(null)
            setMode('movie')
            setSelectedMovie(movie)
            setQuery(movie.title)
            runRecommend({ movieId: movie.id })
            document.getElementById('results')?.scrollIntoView({ behavior: 'smooth' })
          }}
        />
      )}
    </div>
  )
}
