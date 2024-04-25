# Use the base Jupyter Data Science Notebook image
FROM jupyter/datascience-notebook

# Set the maintainer label
LABEL maintainer="Cristobal Barberis <cristobal@barberis.com>"

# Install additional Python packages or dependencies
USER root

# Install system packages required for TensorFlow and other tools
RUN apt-get update && apt-get install -y \
    libsm6 \
    libxext6 \
    libxrender-dev \
    libgl1-mesa-glx \
    && apt-get clean \
    && rm -rf /var/lib/apt/lists/*

# Switch back to jovyan to avoid running as root
USER jovyan

# Install additional Python libraries
RUN pip install --no-cache-dir \
    tensorflow \
    tensorflow-hub \
    seaborn \
    scikit-learn \
    six \
    matplotlib

# Configure environment variables if necessary
# ENV SOME_ENV_VAR some_value
