import { Link } from 'react-router'
import './HomePage.css'
import { APP_ROUTE_PATHS } from '../routePaths'

/**
 * The front door: what the app is, and the way into each half of it.
 *
 * The two working pages have no room to explain themselves, and whoever opens
 * the address cold does not necessarily know which of them they want — so the
 * choice comes first, above the explanation, and the explanation is what tells
 * them which card to press. Static content only: no camera, no storage, no
 * state.
 */

const SOURCE_REPOSITORY_URL = 'https://github.com/nobeeakon/street_tree_recorder'

export function HomePage() {
  return (
    <main className="home">
      <article className="home__content">
        <header className="home__header">
          <h1 className="home__title">Street Recorder</h1>
          <p className="home__lead">
            Una herramienta para inventariar la calle: se fotografía caminando con el celular y se
            etiqueta después en la computadora.
          </p>
        </header>

        <nav className="home__entries">
          <Link className="entry" to={APP_ROUTE_PATHS.recorder}>
            <span className="entry__icon" aria-hidden="true">
              ●
            </span>
            <span className="entry__text">
              <span className="entry__name">Grabar fotos</span>
              <span className="entry__where">En el celular, caminando por la calle</span>
            </span>
            <span className="entry__arrow" aria-hidden="true">
              →
            </span>
          </Link>

          <Link className="entry" to={APP_ROUTE_PATHS.labeler}>
            <span className="entry__icon" aria-hidden="true">
              ▦
            </span>
            <span className="entry__text">
              <span className="entry__name">Etiquetar fotos</span>
              <span className="entry__where">En la computadora, con las fotos ya tomadas</span>
            </span>
            <span className="entry__arrow" aria-hidden="true">
              →
            </span>
          </Link>
        </nav>

        <section className="home__section">
          <h2 className="home__section-title">Las dos mitades</h2>
          <dl className="home__definitions">
            <dt>Grabar</dt>
            <dd>
              El celular toma una foto cada vez que avanzas la distancia elegida desde la última
              captura. Cada foto se guarda en el dispositivo con las coordenadas en el nombre y
              también dentro del archivo, en los metadatos EXIF. Se pueden compartir por WhatsApp o
              cualquier otro medio.
            </dd>
            <dt>Etiquetar</dt>
            <dd>
              En la computadora se vuelven a abrir esas fotos, se les ponen etiquetas de un catálogo
              que tú defines y se exporta todo —coordenadas y etiquetas— como CSV.
            </dd>
          </dl>
        </section>

        <footer className="home__footer">
          <p className="home__source">
            Código fuente:{' '}
            <a
              className="page-link"
              href={SOURCE_REPOSITORY_URL}
              target="_blank"
              rel="noreferrer noopener"
            >
              github.com/nobeeakon/street_tree_recorder
            </a>
          </p>
        </footer>
      </article>
    </main>
  )
}
