FROM codercom/code-server:4.132.0

USER root
RUN usermod -l clauide -d /home/clauide -m coder \
 && groupmod -n clauide coder \
 && sed -i 's/coder/clauide/' /etc/fixuid/config.yml /etc/sudoers.d/nopasswd
ENV USER=clauide

RUN curl https://mise.run | MISE_VERSION=v2026.8.6 MISE_INSTALL_PATH=/usr/local/bin/mise sh

# GitHub CLI — auth is provisioned per-container by github.js (writes ~/.config/gh/hosts.yml),
# not baked in here.
RUN mkdir -p -m 755 /etc/apt/keyrings \
 && curl -fsSL https://cli.github.com/packages/githubcli-archive-keyring.gpg -o /etc/apt/keyrings/githubcli-archive-keyring.gpg \
 && chmod go+r /etc/apt/keyrings/githubcli-archive-keyring.gpg \
 && echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/githubcli-archive-keyring.gpg] https://cli.github.com/packages stable main" > /etc/apt/sources.list.d/github-cli.list \
 && apt-get update \
 && apt-get install -y gh \
 && rm -rf /var/lib/apt/lists/*

USER clauide
RUN curl -fsSL https://claude.ai/install.sh | bash -s 2.1.233

# Pinned Node.js for stdio MCP servers (most run via `npx`). Shims are appended to ~/.profile
# (not ~/.bashrc) for the same reason `claude`'s own install does — login shells (`bash -lc`,
# what we actually spawn) source .profile but not .bashrc for non-interactive commands.
RUN mise use --global node@22 \
 && echo 'export PATH="$HOME/.local/share/mise/shims:$PATH"' >> /home/clauide/.profile

# Environment variables are provisioned per-container by env.js, which writes ~/.clauide/env. Both
# startup files load it because they cover different shells: .profile is what `bash -lc` reads (the
# Claude Code process we spawn), .bashrc is what the interactive terminals inside VS Code read.
# `set -a` exports everything the file defines without each line needing its own export.
RUN printf '%s\n' \
      'set -a' \
      '[ -f "$HOME/.clauide/env" ] && . "$HOME/.clauide/env"' \
      'set +a' | tee -a /home/clauide/.profile >> /home/clauide/.bashrc

COPY --chown=clauide:clauide home/ /home/

RUN mkdir -p /home/clauide/workspace

EXPOSE 8080
