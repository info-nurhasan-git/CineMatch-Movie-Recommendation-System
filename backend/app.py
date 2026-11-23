from __future__ import annotations

import json
import os
import pickle
import warnings
from pathlib import Path
from typing import Any, Dict, List, Tuple

from flask import Flask, jsonify, request
from sklearn.exceptions import InconsistentVersionWarning
from sklearn.metrics.pairwise import cosine_similarity

# The pickle was created with scikit-learn 1.6.1; newer 1.x versions load it
# safely. Suppress only that specific notice to keep the API logs clean.
warnings.filterwarnings("ignore", category=InconsistentVersionWarning)

BASE_DIR = Path(__file__).resolve().parent
MODEL_PATH = BASE_DIR.parent / "model" / "movie_kmeans_model.pkl"
DATA_PATH = BASE_DIR.parent / "data" / "movies.json"

# The vectorizer was trained on MovieLens-style genre strings such as
# "Action|Adventure|Sci-Fi", so both the API and the UI speak in genres.
GENRE_NAMES = (
    "Action", "Adventure", "Animation", "Children", "Comedy", "Crime",
    "Documentary", "Drama", "Fantasy", "Film-Noir", "Horror", "IMAX",
    "Musical", "Mystery", "Romance", "Sci-Fi", "Thriller", "War", "Western",
)

TERM_LABELS = {
    "sci": "Sci-Fi",
    "fi": "Sci-Fi",
    "film": "Film-Noir",
    "noir": "Film-Noir",
    "imax": "IMAX",
}


def load_assets() -> Tuple[Dict[str, Any] | None, List[Dict[str, Any]], str | None]:
    if not MODEL_PATH.exists():
        return None, [], f"Model file not found at {MODEL_PATH}"
    if not DATA_PATH.exists():
        return None, [], f"Movie dataset not found at {DATA_PATH}"

    try:
        with MODEL_PATH.open("rb") as handle:
            bundle = pickle.load(handle)
        kmeans = bundle["kmeans_model"]
        vectorizer = bundle["tfidf_vectorizer"]

        with DATA_PATH.open("r", encoding="utf-8") as handle:
            movies = json.load(handle)
        if not isinstance(movies, list) or not movies:
            return None, [], "Movie dataset is empty."

        prepared: List[Dict[str, Any]] = []
        for movie in movies:
            genres = [str(g).strip() for g in movie.get("genres", []) if str(g).strip()]
            if not genres:
                continue
            item = dict(movie)
            item["genres"] = genres
            item["genre_text"] = " ".join(genres).lower()
            prepared.append(item)
        if not prepared:
            return None, [], "No movies with genres found in the dataset."

        matrix = vectorizer.transform([m["genre_text"] for m in prepared])
        clusters = [int(value) for value in kmeans.predict(matrix)]
        for movie, cluster in zip(prepared, clusters):
            movie["cluster"] = cluster

        return {
            "kmeans": kmeans,
            "vectorizer": vectorizer,
            "matrix": matrix,
            "clusters": clusters,
        }, prepared, None
    except Exception as exc:  # pragma: no cover - defensive startup guard
        return None, [], f"Could not load model or dataset: {exc}"


ASSETS, MOVIES, ASSET_ERROR = load_assets()
BY_ID = {movie["id"]: movie for movie in MOVIES}


def cluster_labels() -> Dict[int, Dict[str, Any]]:
    if ASSETS is None:
        return {}
    kmeans = ASSETS["kmeans"]
    vectorizer = ASSETS["vectorizer"]
    terms = vectorizer.get_feature_names_out()
    labels: Dict[int, Dict[str, Any]] = {}
    for index, center in enumerate(kmeans.cluster_centers_):
        ranked = sorted(zip(terms, center), key=lambda pair: pair[1], reverse=True)
        themes: List[str] = []
        for term, value in ranked:
            if value <= 0:
                continue
            label = TERM_LABELS.get(str(term), str(term).title())
            if label in ("Genres", "Listed") or label in themes:
                continue
            themes.append(label)
            if len(themes) == 3:
                break
        labels[index] = {
            "id": index,
            "label": " / ".join(themes) if themes else f"Cluster {index}",
            "themes": themes,
            "count": ASSETS["clusters"].count(index),
        }
    return labels


CLUSTERS = cluster_labels()

app = Flask(__name__)

ALLOWED_ORIGIN = os.environ.get("CORS_ALLOW_ORIGIN", "*")


@app.after_request
def add_cors_headers(response):
    response.headers["Access-Control-Allow-Origin"] = ALLOWED_ORIGIN
    response.headers["Access-Control-Allow-Headers"] = "Content-Type"
    response.headers["Access-Control-Allow-Methods"] = "GET, POST, OPTIONS"
    return response


def public_movie(movie: Dict[str, Any]) -> Dict[str, Any]:
    return {
        "id": movie["id"],
        "title": movie["title"],
        "year": movie.get("year"),
        "rating": movie.get("rating"),
        "genres": movie["genres"],
        "overview": movie.get("overview", ""),
        "cluster": movie["cluster"],
        "cluster_label": CLUSTERS.get(movie["cluster"], {}).get("label", ""),
    }


def find_movie(payload: Dict[str, Any]) -> Dict[str, Any] | None:
    movie_id = payload.get("movieId", payload.get("id"))
    if movie_id is not None:
        try:
            return BY_ID.get(int(movie_id))
        except (TypeError, ValueError):
            return None

    title = payload.get("title", payload.get("movie"))
    if not isinstance(title, str) or not title.strip():
        return None
    needle = title.strip().casefold()
    for movie in MOVIES:
        if movie["title"].casefold() == needle:
            return movie
    for movie in MOVIES:
        if needle in movie["title"].casefold():
            return movie
    return None


def parse_genres(value: Any) -> List[str]:
    if isinstance(value, str):
        parts = [part.strip() for part in value.replace("|", ",").split(",")]
    elif isinstance(value, list):
        parts = [str(part).strip() for part in value]
    else:
        parts = []

    available = {genre.casefold(): genre for genre in GENRE_NAMES}
    result: List[str] = []
    for part in parts:
        if not part:
            continue
        canonical = available.get(part.casefold())
        if canonical and canonical not in result:
            result.append(canonical)
    return result


def build_query(payload: Dict[str, Any]):
    """Return (vector, description, query details) or raise ValueError."""
    if not isinstance(payload, dict):
        raise ValueError("Request body must be a JSON object.")

    movie = find_movie(payload)
    genres = parse_genres(payload.get("genres"))

    if movie is not None:
        vector = ASSETS["vectorizer"].transform([movie["genre_text"]])
        description = f"Because you like {movie['title']}"
        details = {
            "type": "movie",
            "movie": public_movie(movie),
            "genres": movie["genres"],
        }
        return vector, description, details, movie["cluster"]

    if genres:
        text = " ".join(genres).lower()
        vector = ASSETS["vectorizer"].transform([text])
        cluster = int(ASSETS["kmeans"].predict(vector)[0])
        description = "Curated for your taste"
        details = {"type": "genres", "genres": genres, "movie": None}
        return vector, description, details, cluster

    raise ValueError("Provide 'movieId' or 'title', or select at least one valid genre.")


def recommend(vector, details: Dict[str, Any], cluster: int, limit: int) -> List[Dict[str, Any]]:
    similarities = cosine_similarity(vector, ASSETS["matrix"])[0]
    ratings = [float(movie.get("rating") or 0) for movie in MOVIES]
    low, high = min(ratings), max(ratings)
    span = high - low or 1.0

    exclude_id = details.get("movie", {}).get("id") if details.get("movie") else None
    candidates = [
        (index, movie, float(similarities[index]))
        for index, movie in enumerate(MOVIES)
        if movie["cluster"] == cluster and movie["id"] != exclude_id
    ]
    candidates.sort(
        key=lambda row: 0.78 * row[2] + 0.22 * ((float(row[1].get("rating") or 0) - low) / span),
        reverse=True,
    )

    source_genres = set(details["genres"])
    results: List[Dict[str, Any]] = []
    for _, movie, similarity in candidates[:limit]:
        item = public_movie(movie)
        shared = sorted(source_genres & set(movie["genres"]))
        if details["type"] == "movie":
            reason = (
                f"Same genre DNA as {details['movie']['title']}"
                if similarity >= 0.9
                else f"Shares {', '.join(shared) or 'a similar vibe'} with your pick"
            )
        else:
            reason = f"Matches your {', '.join(details['genres'])} mood"
        item["match"] = int(round(similarity * 100))
        item["reason"] = reason
        results.append(item)
    return results


@app.route("/")
def index():
    return jsonify(
        {
            "name": "ReelMatch API",
            "status": "running" if ASSETS is not None else "unavailable",
            "endpoints": [
                "/api/health", "/api/options", "/api/movies",
                "/api/search", "/api/recommend", "/api/clusters",
            ],
        }
    )


@app.route("/api/health")
def health():
    return jsonify(
        {
            "status": "ok" if ASSETS is not None else "error",
            "model_loaded": ASSETS is not None,
            "model_path": str(MODEL_PATH),
            "movies": len(MOVIES),
            "clusters": len(CLUSTERS),
            "error": ASSET_ERROR,
        }
    )


@app.route("/api/options")
def options():
    return jsonify({"genres": list(GENRE_NAMES), "clusters": list(CLUSTERS.values())})


@app.route("/api/clusters")
def clusters():
    return jsonify({"clusters": list(CLUSTERS.values())})


@app.route("/api/movies")
def movies():
    try:
        limit = int(request.args.get("limit", len(MOVIES)))
    except (TypeError, ValueError):
        limit = len(MOVIES)
    limit = max(1, min(limit, len(MOVIES)))
    ordered = sorted(MOVIES, key=lambda movie: float(movie.get("rating") or 0), reverse=True)
    return jsonify({"total": len(MOVIES), "movies": [public_movie(m) for m in ordered[:limit]]})


@app.route("/api/search")
def search():
    term = request.args.get("q", "").strip().casefold()
    if not term:
        return jsonify({"results": []})
    matches = [movie for movie in MOVIES if term in movie["title"].casefold()]
    matches.sort(key=lambda movie: float(movie.get("rating") or 0), reverse=True)
    return jsonify({"results": [public_movie(m) for m in matches[:8]]})


@app.route("/api/movies/<int:movie_id>")
def movie_detail(movie_id: int):
    movie = BY_ID.get(movie_id)
    if movie is None:
        return jsonify(error="Movie not found."), 404
    payload = public_movie(movie)
    payload["similar"] = recommend(
        ASSETS["vectorizer"].transform([movie["genre_text"]]),
        {
            "type": "movie",
            "movie": payload,
            "genres": movie["genres"],
        },
        movie["cluster"],
        6,
    )
    return jsonify(payload)


@app.route("/api/recommend", methods=["POST", "OPTIONS"])
def recommendations():
    if request.method == "OPTIONS":
        return jsonify({"ok": True})

    if request.content_type and "application/json" not in request.content_type:
        return jsonify(error="Content-Type must be application/json."), 415
    payload = request.get_json(silent=True)
    if payload is None:
        return jsonify(error="Invalid or missing JSON body."), 400

    if ASSETS is None:
        return jsonify(error=f"Model is unavailable. {ASSET_ERROR}"), 503

    try:
        try:
            limit = int(payload.get("limit", 8))
        except (TypeError, ValueError):
            limit = 8
        limit = max(1, min(limit, 20))
        vector, description, details, cluster = build_query(payload)
        results = recommend(vector, details, cluster, limit)
    except ValueError as exc:
        return jsonify(error=str(exc)), 400
    except Exception as exc:  # pragma: no cover - defensive runtime guard
        return jsonify(error=f"Recommendation failed: {exc}"), 500

    cluster_info = CLUSTERS.get(cluster, {"id": cluster, "label": f"Cluster {cluster}", "themes": []})
    return jsonify(
        {
            "description": description,
            "query": details,
            "cluster": cluster_info,
            "results": results,
            "total": len(results),
        }
    )


@app.errorhandler(404)
def not_found(_error):
    return jsonify(error="Endpoint not found."), 404


@app.errorhandler(405)
def method_not_allowed(_error):
    return jsonify(error="Method not allowed."), 405


if __name__ == "__main__":
    port = int(os.environ.get("PORT", "5001"))
    if ASSETS is None:
        app.logger.warning("Assets not loaded: %s", ASSET_ERROR)
    app.run(host="0.0.0.0", port=port, debug=os.environ.get("FLASK_DEBUG") == "1")
