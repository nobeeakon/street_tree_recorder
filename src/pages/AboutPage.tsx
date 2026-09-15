import { Link } from 'react-router'
import './AboutPage.css'
import { APP_ROUTE_PATHS } from '../routePaths'

/**
 * What the app does, in short.
 *
 * The other two pages are working surfaces with no room to explain themselves;
 * this is where the explanation lives, in the same language as the rest of the
 * interface. Static content only — no camera, no storage, no state.
 */

const SOURCE_REPOSITORY_URL = 'https://github.com/nobeeakon/street_tree_recorder'

export function AboutPage() {
  return (
    <main className="about">
      <article className="about__content">
        <header className="about__header">
          <h1 className="about__title">Acerca de Street Recorder</h1>
          <p className="about__lead">
            Una herramienta para inventariar la calle: se fotografía andando con el
            móvil y se etiqueta después en el ordenador.
          </p>
        </header>

        <section className="about__section">
          <h2 className="about__section-title">Las dos mitades</h2>
          <dl className="about__definitions">
            <dt>Grabar</dt>
            <dd>
              El móvil toma una foto cada vez que te has alejado la distancia elegida (10, 25, 50,
              100 o 200 m) de la última captura. Cada foto se guarda en el dispositivo con las
              coordenadas en el nombre y también dentro del archivo, en los metadatos EXIF. Se 
              pueden compartir por whatsapp o cualquier otro medio.
            </dd>
            <dt>Etiquetar</dt>
            <dd>
              En el ordenador se vuelven a abrir esas fotos, se les ponen etiquetas de un catálogo
              que tú defines y se exporta todo —coordenadas y etiquetas— como CSV.
            </dd>
          </dl>
        </section>

        <footer className="about__footer">
          <nav className="about__navigation">
            <Link className="page-link" to={APP_ROUTE_PATHS.recorder}>
              ← Grabar
            </Link>
            <Link className="page-link" to={APP_ROUTE_PATHS.labeler}>
              Etiquetar fotos →
            </Link>
          </nav>
          <p className="about__source">
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
