FROM python:3.12-slim

# curl + ca-certificates: absent from the slim base; needed by solc-select and foundryup.
RUN apt-get update \
 && apt-get install -y --no-install-recommends curl ca-certificates \
 && rm -rf /var/lib/apt/lists/*

RUN pip install --no-cache-dir slither-analyzer \
 && pip cache purge

# solc via solc-select; pin one version
RUN pip install --no-cache-dir solc-select \
 && solc-select install 0.8.24 && solc-select use 0.8.24 \
 && pip cache purge

# Foundry (Ruling 6): crytic-compile detects foundry.toml and invokes `forge build`,
# so the image must ship the forge toolchain. Slow layer kept below the pip layers
# and above the COPY so run.sh edits never invalidate the foundryup cache.
RUN curl -L https://foundry.paradigm.xyz | bash \
 && /root/.foundry/bin/foundryup
ENV PATH="/root/.foundry/bin:${PATH}"

WORKDIR /repo
COPY run.sh /usr/local/bin/run.sh
RUN chmod +x /usr/local/bin/run.sh
ENTRYPOINT ["/usr/local/bin/run.sh"]
