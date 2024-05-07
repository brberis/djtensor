# djtensor

# Project Installation Instructions

## Prerequisites

### Install Docker

#### For Mac:
- Download Docker Desktop for Mac from [Docker Hub](https://hub.docker.com/editions/community/docker-ce-desktop-mac/).
- Follow the installer's instructions to complete the installation.

## Setup

1. **Clone the Repository**

 Clone the project repository to your local machine using:
 ```git clone https://github.com/brberis/djtensor.git```


2. **Environment Configuration**

Copy the `.env.dev.example` file to create a `.env.dev` file and update the environment variables as needed:


3. **Build the Containers**

Navigate to the project directory where the `docker-compose.yml` file is located and run the following command to build the Docker containers:

```docker-compose build```


4. **Start the Services**

Start the services defined in the Docker Compose configuration file with:

```docker-compose up```


Alternatively, you can run them in detached mode using:

```docker-compose up -d```


5. **Access the Application**

Once the containers are up and running, you can access the frontend application by navigating to `http://localhost:3000` in your browser. The backend API will be available at `http://localhost:8000`. Username: `testuser` Password: `testpassword`.

## Stopping the Services

To stop all services, you can run:

```docker-compose down```


## Contributors

- **Dêvi Hall** - [GitHub](https://github.com/devihall)
- **Cristobal Barberis** - [GitHub](https://github.com/brberis)

