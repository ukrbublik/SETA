FROM node:8.4.0

COPY ./seta /var/www/seta

WORKDIR /var/www/seta

VOLUME [ "/var/www/seta/data/" ]

RUN mkdir -p /var/log/node/

RUN cd /var/www/seta && npm install

EXPOSE 80

CMD [ "/bin/bash" ]
CMD [ "node", "server.js" ]

