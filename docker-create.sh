#!/bin/sh

docker build -f seta.Dockerfile  --build-arg NODE_ENV='stage' -t seta-base .
docker tag seta-base ukrbublik.docker/seta-base:latest

docker network create -d bridge --subnet 172.21.0.0/16 seta_nw | echo 'Network not created'
docker run -p 8081:80 --name=container-seta-node --network=seta_nw  -e NODE_ENV='stage' -it -d seta-base


