import pickle
from sklearn.feature_extraction.text import TfidfVectorizer
from sklearn.cluster import KMeans
from google.colab import files

# Prepare the genre data (handling missing genres)
df['genres_clean'] = df['genres'].fillna('').str.replace('|', ' ')

# Vectorize the genres using TF-IDF
tfidf = TfidfVectorizer(stop_words='english')
tfidf_matrix = tfidf.fit_transform(df['genres_clean'])

# Train KMeans model with 5 clusters
kmeans_model = KMeans(n_clusters=5, random_state=42, n_init=10)
df['cluster'] = kmeans_model.fit_predict(tfidf_matrix)

# Save the model and vectorizer as a .pkl file
model_data = {
    'kmeans_model': kmeans_model,
    'tfidf_vectorizer': tfidf
}

with open('movie_kmeans_model.pkl', 'wb') as f:
    pickle.dump(model_data, f)

print("KMeans model trained and saved successfully as 'movie_kmeans_model.pkl'!")