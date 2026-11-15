import * as React from "react";
import { Link } from "@tanstack/react-router";

import {
  creatorDefinitions,
  type CreatorDefinition,
} from "./creators/creator-registry";
import styles from "./creator-index.module.css";

function preloadCreator(definition: CreatorDefinition): void {
  void definition.load().catch(() => undefined);
}

export function CreatorIndex(): React.JSX.Element {
  React.useEffect(() => {
    document.title = "Background Creators · Toolcraft";
  }, []);

  return (
    <main className={styles.page} data-testid="creator-index">
      <div className={styles.shell}>
        <header className={styles.header}>
          <div className={styles.kickerRow}>
            <p className={styles.kicker}>Toolcraft / Background lab</p>
            <p className={styles.status}>
              <span className={styles.statusDot} aria-hidden="true" />
              5 instruments online
            </p>
          </div>

          <div className={styles.intro}>
            <h1 className={styles.title}>Background creators</h1>
            <p className={styles.summary}>
              Five visual instruments, one shared runtime. Choose a generator
              to shape, animate, and export a landing-page background.
            </p>
          </div>
        </header>

        <nav aria-label="Background creators" className={styles.creatorNav}>
          <ol className={styles.creatorList}>
            {creatorDefinitions.map((definition, index) => {
              const descriptionId = `${definition.slug}-description`;

              return (
                <li className={styles.creatorItem} key={definition.slug}>
                  <Link
                    aria-describedby={descriptionId}
                    className={styles.creatorLink}
                    onFocus={() => preloadCreator(definition)}
                    onPointerEnter={() => preloadCreator(definition)}
                    to={definition.path}
                  >
                    <span className={styles.sequence}>
                      {String(index + 1).padStart(2, "0")}
                    </span>

                    <span className={styles.creatorCopy}>
                      <span className={styles.creatorTitleRow}>
                        <span className={styles.creatorTitle}>
                          {definition.title}
                        </span>
                        <span className={styles.arrow} aria-hidden="true">
                          ↗
                        </span>
                      </span>
                      <span
                        className={styles.creatorDescription}
                        id={descriptionId}
                      >
                        {definition.description}
                      </span>
                      <span className={styles.route}>{definition.path}</span>
                    </span>

                    <span
                      aria-hidden="true"
                      className={styles.preview}
                      data-creator={definition.slug}
                    >
                      <span className={styles.previewGrid} />
                      <span className={styles.previewMark} />
                    </span>
                  </Link>
                </li>
              );
            })}
          </ol>
        </nav>

        <footer className={styles.footer}>
          <span>Convoy landing playground</span>
          <span>Shared Toolcraft runtime / routed compositions</span>
        </footer>
      </div>
    </main>
  );
}
