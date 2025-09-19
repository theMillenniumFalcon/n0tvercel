## Base image: Ubuntu 20.04 LTS (Focal)
FROM ubuntu:focal

## Install Node.js 20.x via NodeSource and update system packages
RUN apt-get update
RUN apt-get install -y curl
RUN curl -sL https://deb.nodesource.com/setup_20.x | bash -
RUN apt-get upgrade -y
RUN apt-get install -y nodejs

## Install TypeScript runner (tsx) and TypeScript compiler
RUN npm install -g tsx typescript

## Install Git (used for fetching dependencies or during build)
RUN apt-get install git -y

## Set working directory for subsequent commands and runtime
WORKDIR /home/app

## Copy entrypoint script into image (relative to WORKDIR)
COPY main.sh main.sh

## Copy TypeScript sources and project config
COPY script.ts script.ts
COPY tsconfig.json tsconfig.json
## Copy package manifests for dependency install layer caching
COPY package*.json .

## Install Node dependencies for the project
RUN npm install

RUN chmod +x main.sh

## Set the container entrypoint script (must be present and executable)
ENTRYPOINT [ "/home/app/main.sh" ]