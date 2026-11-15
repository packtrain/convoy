# PR writes act as the user's own GitHub account

Every change Convoy makes on GitHub (comments, reviews, merges, state changes) runs with the acting user's Linked GitHub account, through a GitHub App user-to-server token. It never runs as a `convoy[bot]` installation token. GitHub then attributes the change to the person, and that person's repository role decides what is allowed, so Convoy grants exactly the rights GitHub does. Reading still uses the project's installation, so members without a Linked GitHub account can browse.

## Considered Options

- A bot installation token for writes: no per-user setup, but every change shows as the bot and Convoy would have to reimplement GitHub's permission rules on top.
- The lower of the Convoy role and the GitHub role: rejected, because blocking an action in Convoy that the user can do on github.com protects nothing.
