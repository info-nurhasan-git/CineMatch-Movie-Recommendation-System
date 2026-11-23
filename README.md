# ReelMatch · AI Movie Recommender

A React website that uses your trained `movieRecom/model/movie_kmeans_model.pkl`
model to recommend movies. The pickle contains a **TF-IDF vectorizer** plus a
**K-Means** model (5 clusters) trained on MovieLens-style genre strings like
`"Action|Adventure|Sci-Fi"`.

The React UI talks to a small Flask API, because a `.pkl` model cannot run in a
browser.

## What's inside

```
movieRecom/
├── backend/
│   ├── app.py               # Flask API: loads the pickle + movie catalogue
│   └── requirements.txt
├── data/
│   └── movies.json          # 88 movies with title, year, genres, rating, overview
├── frontend/                # Vite + React UI
│   ├── src/App.jsx
│   └── src/styles.css
├── model/
│   └── movie_kmeans_model.pkl   # your existing model (unchanged)
└── README.md
```

## Run locally

**1. Backend** (terminal 1):

```bash
cd movieRecom/backend
pip install -r requirements.txt
python app.py
```

Flask listens on `http://127.0.0.1:5001`.

**2. Frontend** (terminal 2):

```bash
cd movieRecom/frontend
npm install
npm run dev
```

Open `http://127.0.0.1:5175`. Vite proxies `/api` to Flask.

## How the recommendation works

1. Every movie in `data/movies.json` is converted to a genre string, e.g.
   `action sci-fi thriller`.
2. The pickled `TfidfVectorizer` turns that string into a vector.
3. The pickled `KMeans` model assigns the movie to one of 5 taste clusters.
4. For a request, the API finds the cluster and ranks other movies in it by
   cosine similarity of their genre vectors, with a small rating boost.
5. The UI shows each result with a match %, the reason, and a "find similar" action.

You can recommend by **movie title/id** or by selecting **genres**.

## API

| Endpoint | Purpose |
| --- | --- |
| `GET /api/health` | Model/dataset load status |
| `GET /api/options` | Genre list and cluster labels |
| `GET /api/movies?limit=12` | Movies sorted by rating |
| `GET /api/search?q=inception` | Title autocomplete |
| `GET /api/movies/<id>` | Movie detail with similar titles |
| `POST /api/recommend` | Main recommendation endpoint |

Example request:

```json
{ "movieId": 3, "limit": 8 }
```

or:

```json
{ "genres": ["Horror", "Thriller"], "limit": 8 }
```

Example response (shortened):

```json
{
  "description": "Because you like Inception",
  "cluster": { "id": 3, "label": "Action / Thriller / Crime", "count": 50 },
  "results": [
    { "title": "Blade Runner", "match": 97, "reason": "Same genre DNA as Inception" }
  ]
}
```

## Using your own movie dataset

Replace `data/movies.json` with a JSON list. Each item needs:

```json
{
  "id": 101,
  "title": "Movie title",
  "year": 2020,
  "rating": 8.1,
  "genres": ["Action", "Adventure", "Sci-Fi"],
  "overview": "Short description."
}
```

Use the same genre vocabulary the vectorizer was trained on (MovieLens genres:
Action, Adventure, Animation, Children, Comedy, Crime, Documentary, Drama,
Fantasy, Film-Noir, Horror, IMAX, Musical, Mystery, Romance, Sci-Fi, Thriller,
War, Western). Restart the Flask backend after changing the file.

## Production build

```bash
cd frontend && npm run build
```

Serve `frontend/dist` as static files and keep the Flask API reachable at `/api`.
