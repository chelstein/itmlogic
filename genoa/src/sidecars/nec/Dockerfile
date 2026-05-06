FROM ubuntu:22.04

RUN apt-get update && apt-get install -y \
  git build-essential swig python3 python3-pip autoconf automake libtool nodejs npm \
  && rm -rf /var/lib/apt/lists/*

RUN git clone --recurse-submodules https://github.com/tmolteno/python-necpp.git /tmp/python-necpp

RUN cd /tmp/python-necpp/necpp_src && \
  make -f Makefile.git && \
  ./configure --without-lapack && \
  make && make install

RUN cd /tmp/python-necpp/PyNEC && \
  ln -s ../necpp_src . && \
  swig -Wall -c++ -python PyNEC.i && \
  pip3 install --no-build-isolation .

WORKDIR /app
COPY server.js .

EXPOSE 8085
CMD ["node", "server.js"]
