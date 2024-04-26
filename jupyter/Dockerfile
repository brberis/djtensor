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

# Create a directory for the log file
USER root
RUN mkdir /var/log/jupyter && chown jovyan /var/log/jupyter
USER jovyan

# Set the entrypoint to start Jupyter and redirect logs
ENTRYPOINT ["sh", "-c"]
CMD ["jupyter notebook --ip='*' --port=8888 --no-browser --NotebookApp.token='k96y%tiq26be!tqb#p' --NotebookApp.password='' > /var/log/jupyter/jupyter.log 2>&1"]
