#!/bin/bash

# Function to generate a random Django SECRET_KEY
generate_secret_key() {
  python3 -c "from django.core.management.utils import get_random_secret_key; print(get_random_secret_key())"
}

# Check if at least two arguments are provided
if [ "$#" -lt 2 ]; then
  echo "Usage: $0 <host1> <host2> ... <hostN>"
  exit 1
fi

# Collect all host arguments
HOSTS=("$@")
FIRST_HOST=${HOSTS[0]}

# Detect NVIDIA GPU using lspci
if lspci | grep -i nvidia > /dev/null; then
  echo "NVIDIA GPU detected. Installing NVIDIA driver and CUDA toolkit."

  # Add NVIDIA package repositories
  sudo apt-get update
  sudo apt-get install -y software-properties-common
  sudo add-apt-repository ppa:graphics-drivers/ppa
  sudo apt-get update

  # Install the appropriate NVIDIA driver
  sudo apt-get install -y nvidia-driver-530

  # Load NVIDIA driver without reboot
  sudo modprobe nvidia

  # Verify the installation
  if nvidia-smi > /dev/null 2>&1; then
    GPU_MODEL=$(nvidia-smi --query-gpu=name --format=csv,noheader)
    echo "NVIDIA GPU model detected: $GPU_MODEL"

    # Install CUDA toolkit
    sudo apt-get install -y nvidia-cuda-toolkit
  else
    echo "Failed to communicate with NVIDIA driver. Make sure the driver is installed and running."
    exit 1
  fi
else
  echo "No NVIDIA GPU detected. Skipping CUDA driver installation."
fi

# Update package list and install prerequisites
sudo apt-get update
sudo apt-get install -y \
    apt-transport-https \
    ca-certificates \
    curl \
    software-properties-common

# Add Docker’s official GPG key
curl -fsSL https://download.docker.com/linux/ubuntu/gpg | sudo apt-key add -

# Add Docker’s official repository
sudo add-apt-repository \
   "deb [arch=amd64] https://download.docker.com/linux/ubuntu \
   $(lsb_release -cs) \
   stable"

# Update package list again to include Docker's packages
sudo apt-get update

# Install Docker CE
sudo apt-get install -y docker-ce docker-ce-cli containerd.io

# Install Docker Compose
sudo curl -L "https://github.com/docker/compose/releases/download/2.10.2/docker-compose-$(uname -s)-$(uname -m)" -o /usr/local/bin/docker-compose
sudo chmod +x /usr/local/bin/docker-compose

# Add the package repositories for NVIDIA Container Toolkit
if nvidia-smi > /dev/null 2>&1; then
    distribution=$(. /etc/os-release;echo $ID$VERSION_ID)
    curl -s -L https://nvidia.github.io/nvidia-docker/gpgkey | sudo apt-key add -
    curl -s -L https://nvidia.github.io/nvidia-docker/$distribution/nvidia-docker.list | sudo tee /etc/apt/sources.list.d/nvidia-docker.list

    # Update the package lists and install the NVIDIA Container Toolkit
    sudo apt-get update
    sudo apt-get install -y nvidia-docker2

    # Restart the Docker daemon to complete the installation
    sudo systemctl restart docker
fi

# Add current user to the docker group to run docker commands without sudo
sudo usermod -aG docker $USER

# Generate a random Django SECRET_KEY
SECRET_KEY=$(generate_secret_key)

# Create the .env.prod file with the provided environment variables
cat <<EOL > .env.prod
DEBUG=0
SECRET_KEY=${SECRET_KEY}
DJANGO_ALLOWED_HOSTS=localhost 127.0.0.1 [::1] backend ${HOSTS[*]}
NEXT_PUBLIC_API_BASE_URL=http://${FIRST_HOST}
DJANGO_API_BASE_URL=http://${FIRST_HOST}/data
SQL_ENGINE=django.db.backends.postgresql
SQL_DATABASE=backend_prod
SQL_USER=backend
SQL_PASSWORD=backend
SQL_HOST=db
SQL_PORT=5432
DATABASE=postgres
EOL

# Print Docker and Docker Compose versions
docker --version
docker-compose --version

echo "Docker and Docker Compose installation completed. Please log out and log back in for the changes to take effect."

# Run Docker Compose to build and start the services
docker-compose -f docker-compose.prod.yml up --build -d
