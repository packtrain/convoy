FROM node:22-bookworm
ARG CONVOY_VERSION
RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 bubblewrap sudo git gh util-linux procps ca-certificates iptables ipset iproute2 dnsutils aggregate jq \
    && rm -rf /var/lib/apt/lists/*
RUN npm install --prefix /opt/convoy @useconvoy/cli@${CONVOY_VERSION} \
    && npm install -g @anthropic-ai/claude-code @openai/codex@0.156.1 opencode-ai@1.19.5 \
    && ln -s /opt/convoy/node_modules/@useconvoy/cli/dist/bin/convoy.js /usr/local/bin/convoy \
    && corepack enable
# Cursor Agent, root-owned so projects can run it; the version Convoy tested (OS-2017).
RUN case "$(dpkg --print-architecture)" in \
      amd64) arch=x64 sum=85296944e4600a83c4b764f578d1502bf9c416db200d33a593e8f3ecabfdc294 ;; \
      arm64) arch=arm64 sum=22a36df9720830668ccd4d707e5190204ab9c8a0efb2f068cc914895f804d3ec ;; \
      *) echo "Cursor Agent has no build for $(dpkg --print-architecture)" >&2; exit 1 ;; \
    esac \
    && curl -fsSL -o /tmp/cursor-agent.tgz "https://downloads.cursor.com/lab/2026.10.22-27dcf5f/linux/${arch}/agent-cli-package.tar.gz" \
    && echo "${sum}  /tmp/cursor-agent.tgz" | sha256sum -c - \
    && mkdir -p /usr/local/lib/cursor-agent \
    && tar --no-same-owner --strip-components=1 -xzf /tmp/cursor-agent.tgz -C /usr/local/lib/cursor-agent \
    && rm /tmp/cursor-agent.tgz && chmod -R go-w /usr/local/lib/cursor-agent \
    && ln -s /usr/local/lib/cursor-agent/cursor-agent /usr/local/bin/cursor-agent
# Antigravity CLI, root-owned; the build the managed install pins (ANTIGRAVITY_BUILD, OS-2475).
RUN case "$(dpkg --print-architecture)" in \
      amd64) path=linux-x64/cli_linux_x64 sum=83311d3f354567612dc16c1ae2ea9b503d6f6833aa4e138d39aa229da3f3bb99b0e4d7cca0bce4796b0060d6a51d8113eb7449ed5dc0e7900bf217107ea5bff9 ;; \
      arm64) path=linux-arm/cli_linux_arm64 sum=c9b29bba475f63a1a80161ae93ba72b221c7a586d9851e4d0061546704bab66d6b2760b25d716d191724fc7564f3246456ee151e28aa37af48dbcd72bdc6c463 ;; \
      *) echo "Antigravity has no build for $(dpkg --print-architecture)" >&2; exit 1 ;; \
    esac \
    && curl -fsSL -o /tmp/agy.tgz "https://storage.googleapis.com/antigravity-public/antigravity-cli/1.5.14-5302690847260672/${path}.tar.gz" \
    && echo "${sum}  /tmp/agy.tgz" | sha512sum -c - \
    && tar --no-same-owner -xzf /tmp/agy.tgz -C /usr/local/bin antigravity \
    && rm /tmp/agy.tgz && chmod go-w /usr/local/bin/antigravity \
    && ln -s antigravity /usr/local/bin/agy
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

COPY launcher.py install.py /usr/local/share/convoy-projects/
COPY start.sh /usr/local/libexec/convoy-project-start
COPY init-firewall.sh /usr/local/bin/init-firewall.sh
RUN chmod 0755 /usr/local/libexec/convoy-project-start /usr/local/bin/init-firewall.sh \
    && mkdir -p /workspace /home/node/.config/convoy /var/lib/convoy-projects \
    && chown node:node /workspace /home/node/.config/convoy \
    && chmod 0700 /home/node/.config/convoy \
    && chmod 0711 /var/lib/convoy-projects \
    && printf '%s\n' \
      'node ALL=(root) NOPASSWD: /usr/local/libexec/convoy-project-start, /usr/local/bin/init-firewall.sh' \
      'Defaults env_keep += "DEVCONTAINER_NETWORK_MODE CONVEX_DEPLOYMENT DEVCONTAINER_EXTRA_ALLOWED_DOMAINS"' \
      > /etc/sudoers.d/convoy-project-start \
    && chmod 0440 /etc/sudoers.d/convoy-project-start
USER node
WORKDIR /workspace
