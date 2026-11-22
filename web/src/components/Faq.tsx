import geo from "../content/geo.json";

/** The same questions and answers that are written into the page's HTML for search and AI crawlers. */
export function Faq() {
  return (
    <section className="faq" aria-labelledby="faq-h">
      <h2 id="faq-h">Questions</h2>
      <div className="faq-list">
        {geo.faq.map((f) => (
          <details key={f.q}>
            <summary>{f.q}</summary>
            <p>{f.a}</p>
          </details>
        ))}
      </div>
    </section>
  );
}
