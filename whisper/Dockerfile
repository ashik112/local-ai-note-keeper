FROM debian:bookworm-slim

ARG WHISPER_CPP_REF=v1.8.1

RUN apt-get update \
    && apt-get install -y --no-install-recommends \
        build-essential \
        ca-certificates \
        cmake \
        curl \
        ffmpeg \
        git \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /opt

RUN git clone --depth 1 --branch "${WHISPER_CPP_REF}" https://github.com/ggml-org/whisper.cpp.git \
    && cmake -S whisper.cpp -B whisper.cpp/build \
        -DCMAKE_BUILD_TYPE=Release \
        -DGGML_NATIVE=OFF \
        -DGGML_CPU_ARM_ARCH=armv8-a \
    && cmake --build whisper.cpp/build --config Release -j 2

WORKDIR /opt/whisper.cpp

ENV PATH="/opt/whisper.cpp/build/bin:${PATH}"

EXPOSE 8080
