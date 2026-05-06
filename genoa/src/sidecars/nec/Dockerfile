FROM ubuntu:22.04

ENV DEBIAN_FRONTEND=noninteractive

# ---- system deps ----
RUN apt-get update && apt-get install -y \
  git \
  build-essential \
  swig \
  python3 \
  python3-pip \
  python3-dev \
  python3-numpy \
  autoconf \
  automake \
  libtool \
  nodejs \
  npm \
  ca-certificates \
  && rm -rf /var/lib/apt/lists/*

# ---- upgrade pip toolchain ----
RUN pip3 install --upgrade pip setuptools wheel numpy

# ---- get real NEC source ----
RUN git clone --recurse-submodules https://github.com/tmolteno/python-necpp.git /tmp/python-necpp

# ---- build NEC2++ core ----
RUN cd /tmp/python-necpp/necpp_src && \
  make -f Makefile.git && \
  ./configure --without-lapack && \
  make && make install

# ---- build PyNEC binding ----
RUN cd /tmp/python-necpp/PyNEC && \
  ln -s ../necpp_src . && \
  swig -Wall -c++ -python PyNEC.i && \
  pip3 install --no-build-isolation .

# ---- app ----
WORKDIR /app
COPY server.js .

EXPOSE 8085

CMD ["node", "server.js"]
