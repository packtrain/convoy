FROM node:22

ARG TZ
ENV TZ="$TZ"

# Install basic development tools and iptables/ipset
RUN apt-get update && apt-get install -y --no-install-recommends \
  less \
  git \
  procps \
  sudo \
  fzf \
  zsh \
  man-db \
  unzip \
  gnupg2 \
  gh \
  iptables \
  ipset \
  iproute2 \
  dnsutils \
  aggregate \
  jq \
  nano \
  vim \
  && apt-get clean && rm -rf /var/lib/apt/lists/*

# Keep image tooling root-owned; only global npm installs belong to node.
RUN mkdir -p /usr/local/share/npm-global && \
  chown -R node:node /usr/local/share/npm-global

# Browser tooling belongs to the image, independently of the Convoy package.
ARG PLAYWRIGHT_CLI_VERSION=0.1.21
RUN npm install --prefix /usr/local/lib/playwright-cli @playwright/cli@${PLAYWRIGHT_CLI_VERSION} \
    && ln -s /usr/local/lib/playwright-cli/node_modules/.bin/playwright-cli /usr/local/bin/playwright-cli \
    && PLAYWRIGHT_BROWSERS_PATH=/usr/local/share/ms-playwright \
       /usr/local/lib/playwright-cli/node_modules/.bin/playwright install --with-deps chromium \
    && mkdir -p /usr/local/share/playwright-cli \
    && PLAYWRIGHT_BROWSERS_PATH=/usr/local/share/ms-playwright node -e 'const fs=require("node:fs"); const {chromium}=require("/usr/local/lib/playwright-cli/node_modules/playwright"); fs.writeFileSync("/usr/local/share/playwright-cli/config.json", JSON.stringify({browser:{browserName:"chromium",launchOptions:{executablePath:chromium.executablePath(),headless:true,chromiumSandbox:false}}}));' \
    && chmod -R go-w /usr/local/lib/playwright-cli /usr/local/share/playwright-cli /usr/local/share/ms-playwright \
    && chmod -R a+rX /usr/local/share/ms-playwright

ARG USERNAME=node

# Persist bash history.
RUN SNIPPET="export PROMPT_COMMAND='history -a' && export HISTFILE=/commandhistory/.bash_history" \
  && mkdir /commandhistory \
  && touch /commandhistory/.bash_history \
  && chown -R $USERNAME /commandhistory

# Set `DEVCONTAINER` environment variable to help with orientation
ENV DEVCONTAINER=true

# Create workspace and config directories and set permissions. Named volumes
# copy these folders' owner and mode; Convoy refuses config or state wider than 0700.
# ~/.local must pre-exist owned by node: the ~/.local/share/opencode bind mount
# otherwise makes Docker create it as root, which breaks the cursor-agent installer.
RUN mkdir -p /workspace /home/node/.claude /home/node/.gemini /home/node/.local/share /home/node/.local/bin /home/node/.config/convoy /home/node/.convoy && \
  chown -R node:node /workspace /home/node/.claude /home/node/.gemini /home/node/.local /home/node/.config /home/node/.convoy && \
  chmod 700 /home/node/.config/convoy /home/node/.convoy

WORKDIR /workspace

ARG GIT_DELTA_VERSION=0.18.2
RUN ARCH=$(dpkg --print-architecture) && \
  wget "https://github.com/dandavison/delta/releases/download/${GIT_DELTA_VERSION}/git-delta_${GIT_DELTA_VERSION}_${ARCH}.deb" && \
  sudo dpkg -i "git-delta_${GIT_DELTA_VERSION}_${ARCH}.deb" && \
  rm "git-delta_${GIT_DELTA_VERSION}_${ARCH}.deb"

# Enable corepack so a project-pinned package manager (pnpm/yarn) works out of the box
RUN corepack enable

# Set up non-root user
USER node

# Install global packages
ENV NPM_CONFIG_PREFIX=/usr/local/share/npm-global
ENV PATH=$PATH:/usr/local/share/npm-global/bin

# Set the default shell to zsh rather than sh
ENV SHELL=/bin/zsh

# Set the default editor and visual
ENV EDITOR=nano
ENV VISUAL=nano

# Default powerline10k theme
ARG ZSH_IN_DOCKER_VERSION=1.2.0
RUN sh -c "$(wget -O- https://github.com/deluan/zsh-in-docker/releases/download/v${ZSH_IN_DOCKER_VERSION}/zsh-in-docker.sh)" -- \
  -p git \
  -p fzf \
  -a "source /usr/share/doc/fzf/examples/key-bindings.zsh" \
  -a "source /usr/share/doc/fzf/examples/completion.zsh" \
  -a "export PROMPT_COMMAND='history -a' && export HISTFILE=/commandhistory/.bash_history" \
  -x

# Agent CLIs (claude, codex, opencode, cursor-agent, agy) are NOT installed here.
# A `RUN npm install -g ...@latest` layer is cached, so every rebuild reinstates
# whatever version the first build happened to fetch. They install from
# `postCreateCommand` instead, which Docker never caches. cursor-agent and agy land
# in ~/.local/bin and opencode in ~/.opencode/bin. They go on the image PATH because
# the project service starts from postStartCommand, which reads no shell rc file.
ENV PATH=$PATH:/home/node/.local/bin:/home/node/.opencode/bin

# Copy and set up the firewall script
COPY init-firewall.sh /usr/local/bin/
# postStartCommand compares this copy with the checkout to flag a stale image.
COPY Dockerfile /usr/local/share/convoy-devcontainer/Dockerfile
USER root
# env_keep is load-bearing: sudo's default env_reset strips the vars the firewall
# reads, so a strict-mode start (and the manual re-run in README.md) would silently
# lose the Convex, Bedrock-region, and extra-domain allowlist entries.
RUN chmod +x /usr/local/bin/init-firewall.sh && \
  printf '%s\n' \
    'node ALL=(root) NOPASSWD: /usr/local/bin/init-firewall.sh' \
    'Defaults env_keep += "CODEX_HOME CONVEX_DEPLOYMENT AWS_REGION DEVCONTAINER_EXTRA_ALLOWED_DOMAINS"' \
    > /etc/sudoers.d/node-devcontainer && \
  chmod 0440 /etc/sudoers.d/node-devcontainer
USER node
