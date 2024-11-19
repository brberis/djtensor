# Shark AI

## Overview

**Shark AI** is a collaborative AI research project focused on integrating machine learning with paleontology, specifically in the study of fossil shark teeth. The project is part of a larger NSF-funded initiative (Grant No. 2147625) aimed at enhancing STEM education in Florida's public middle schools by incorporating fossil research into the curriculum. The AI component of the project, referred to as PaleoAI, is a spin-off from the primary educational research objectives and aims to address basic research questions in paleontology using advanced machine learning techniques.

### Project Background and Context

- **NSF Funding:** This project is funded by the National Science Foundation (NSF) under Grant No. 2147625 to the University of Florida (UF).
- **Educational Impact:** The research integrates fossil shark teeth studies into Florida public middle schools, involving 50 teachers, over 10,000 students, across 30 counties.
- **Research Team:** The research is conducted by a team of paleontologists, biologists, and software engineers, including professionals and volunteers from UF and other institutions.
- **PaleoAI:** A focused effort on applying machine learning to paleontological data, specifically fossil shark teeth, to answer research questions about species identification and classification.

# Project Installation Instructions

## Prerequisites

### GPU Optimization

The Docker images used in this project are fully compatible with NVIDIA A100 GPUs, taking full advantage of the GPU's Tensor Core architecture for accelerated deep learning workloads.

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


## Team

### Principal Investigators

- **Bruce MacFadden** - Distinguished Professor and Curator of Vertebrate Paleontology at the Florida Museum of Natural History, and Founding Director of the Thompson Earth Systems Institute. With a career at UF since 1977, Bruce has authored several seminal books and over 200 peer-reviewed articles. He has secured more than $35 million in research funding, primarily from NSF, and has held prestigious positions, including President of both the Paleontological Society and the Society of Vertebrate Paleontology. His research spans fossil mammals, paleobiology, and macroevolution, with significant contributions to understanding the biodiversity of the New World tropics through work in the Panama Canal region. Bruce is also heavily involved in K-12 STEM education outreach and is the principal investigator for the current NSF project integrating AI and paleontology in middle schools&#8203;:contentReference[oaicite:0]{index=0}.
- **Victor Perez** - Co-Principal Investigator (Co-PI), PhD from UF, specializing in paleontology.

### Research Team

- **Arthur Porto** - Curator of Artificial Intelligence for Natural History and Biodiversity at the Florida Museum of Natural History. Arthur Porto has a unique background in both biology and machine learning, specializing in using AI to study evolutionary patterns. Prior to his current role, he was an assistant professor at Louisiana State University, where he focused on developing tools like ALPACA to automate the analysis of 3D models of biological specimens&#8203;:contentReference[oaicite:0]{index=0}.
- **Ken Marks** - An experienced researcher with a focus on vertebrate paleontology and fossil shark teeth. Ken Marks has contributed extensively to the study of shark fossils, particularly in Florida, and has been involved in numerous projects aimed at understanding the evolutionary history of these ancient creatures.
- **Stephanie Killingsworth** - PhD student in Geology at UF, focusing on fossil research and paleontology.
- **Maria Camila Vallejos** - PhD candidate in Biology at UF, contributing to the integration of biological sciences with paleontological research.
- **Samantha Zbinden** - UF graduate, PhD student at UT-Austin starting August 2024, involved in fossil shark research.

### Software Development Team


- **Cristobal Barberis** - Software engineer, volunteer, contributing to backend and front end development, infrastructure and system architecture.
- **Arthur Porto**
- **Dêvi Hall** - Software developer, volunteer, responsible for the development and maintenance of the AI tools and software infrastructure.


