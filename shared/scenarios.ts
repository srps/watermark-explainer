// Demo scenarios: hand-authored candidate distributions that mimic what a
// real model's next-token distribution looks like for different content
// types. Each step lists plausible candidates with relative weights.
//
// How the content types behave under the REAL mechanism (no manual gating):
//   - Prose steps have several near-equally-good candidates. The tournament
//     update shifts real probability mass toward keyed candidates, so the
//     signal accumulates quickly.
//   - Facts/quotes/code steps are near-deterministic (one candidate at
//     weight ~100). The update still runs, but a peaked distribution has
//     little mass to move, so these steps have almost no expected watermark
//     lift — exactly as in the real system, for the same mathematical reason.
//   - Any exact repeated four-token contexts are masked by the repetition
//     mechanism and excluded from scoring on both sides.
//
// Token discipline (so pasted text re-detects with the same IDs):
//   - Every candidate text is `leading whitespace + one non-whitespace run`
//     (punctuation folded into the preceding word: "gather.", "\n  if").
//   - IDs are derived from the surface form (tokenId), so every occurrence
//     of the same form — generated or pasted — hashes identically.

import { tokenId } from "./watermark.ts";

export interface Scenario {
  id: string;
  title: string;
  kind: "prose" | "code" | "quote";
  prompt: string;
  blurb: string;
  /** Why this content type behaves the way it does under watermarking. */
  explanation: string;
  specs: { candidates: { id: number; text: string; w: number }[] }[];
  /** Expected watermark density label, e.g. "dense", "sparse", "none". */
  expected: string;
}

const c = (text: string, w: number) => ({ id: tokenId(text), text, w });

export const SCENARIOS: Scenario[] = [
  {
    id: "prose",
    title: "Creative prose",
    kind: "prose",
    prompt: "Write an opening paragraph for a short story about a lighthouse keeper.",
    blurb: "Nearly every word is a genuine choice among near-synonyms. The tournament has maximum room to tilt the sampling.",
    explanation:
      "In free-form prose, most next-word decisions are low-stakes: 'overcast' or 'grey' would both be fine. At each such step, the 30 keyed layers redistribute probability mass toward their favoured candidates, so the sampled text carries a dense g-value pattern. The z-score is noisy from token to token, but evidence tends to accumulate as the paragraph grows.",
    expected: "dense",
    specs: [
      // Sentence 1: "The weather today was cold and overcast."
      { candidates: [c("The", 60), c("A", 20)] },
      { candidates: [c(" weather", 30), c(" sky", 25), c(" morning", 15), c(" sea", 10)] },
      { candidates: [c(" today", 30), c(" yesterday", 15), c(" outside", 10)] },
      { candidates: [c(" was", 70), c(" turned", 8)] },
      { candidates: [c(" cold", 40), c(" bitter", 20), c(" raw", 12), c(" harsh", 8)] },
      { candidates: [c(" and", 55)] },
      { candidates: [c(" overcast.", 22), c(" grey.", 20), c(" drizzly.", 12), c(" sullen.", 8), c(" windy.", 10)] },
      // Sentence 2: "Elias climbed the spiral stairs and paused to listen to the wind gather."
      { candidates: [c(" Elias", 25), c(" Mara", 15), c(" He", 20), c(" She", 10)] },
      { candidates: [c(" climbed", 35), c(" mounted", 8), c(" ascended", 6)] },
      { candidates: [c(" the", 75), c(" its", 8)] },
      { candidates: [c(" spiral", 22), c(" iron", 20), c(" narrow", 18), c(" stone", 14)] },
      { candidates: [c(" stairs", 40), c(" steps", 30)] },
      { candidates: [c(" and", 30)] },
      { candidates: [c(" paused", 18), c(" stopped", 12), c(" waited", 9)] },
      { candidates: [c(" to", 55)] },
      { candidates: [c(" listen", 30), c(" hear", 15)] },
      { candidates: [c(" to", 55)] },
      { candidates: [c(" the", 70), c(" a", 8)] },
      { candidates: [c(" wind", 30), c(" fog", 18), c(" tide", 12), c(" rain", 14)] },
      { candidates: [c(" gather.", 16), c(" thicken.", 14), c(" arrive.", 10), c(" howl.", 12)] },
      // Sentence 3: "He had kept this light for eleven winters, and still the sea found new ways to complain."
      { candidates: [c(" He", 40), c(" She", 15), c(" Elias", 10)] },
      { candidates: [c(" had", 55), c(" has", 10)] },
      { candidates: [c(" kept", 35), c(" tended", 18), c(" manned", 8)] },
      { candidates: [c(" this", 45), c(" that", 15), c(" the", 12)] },
      { candidates: [c(" light", 40), c(" lamp", 20), c(" beacon", 10)] },
      { candidates: [c(" for", 60)] },
      { candidates: [c(" eleven", 22), c(" twenty", 18), c(" nine", 14), c(" thirty", 12)] },
      { candidates: [c(" winters,", 40), c(" years,", 30), c(" seasons,", 8)] },
      { candidates: [c(" and", 50)] },
      { candidates: [c(" still", 30), c(" always", 8)] },
      { candidates: [c(" the", 60), c(" that", 8)] },
      { candidates: [c(" sea", 45), c(" ocean", 18), c(" water", 12)] },
      { candidates: [c(" found", 30), c(" devised", 8), c(" discovered", 6)] },
      { candidates: [c(" new", 35), c(" other", 12), c(" fresh", 12), c(" strange", 10)] },
      { candidates: [c(" ways", 40), c(" means", 10), c(" tricks", 12)] },
      { candidates: [c(" to", 65)] },
      { candidates: [c(" complain.", 30), c(" roar.", 12), c(" grumble.", 12), c(" sigh.", 10)] },
      // Sentence 4: "Some nights it muttered; some nights it roared like a wronged animal."
      { candidates: [c(" Some", 40), c(" Many", 12), c(" Most", 10)] },
      { candidates: [c(" nights", 45), c(" evenings", 12)] },
      { candidates: [c(" it", 65)] },
      { candidates: [c(" muttered;", 25), c(" murmured;", 15), c(" whispered;", 10), c(" grumbled;", 10)] },
      { candidates: [c(" some", 50), c(" other", 10)] },
      { candidates: [c(" nights", 45), c(" evenings", 12)] },
      { candidates: [c(" it", 65)] },
      { candidates: [c(" roared", 30), c(" howled", 20), c(" screamed", 10), c(" thundered", 10)] },
      { candidates: [c(" like", 55), c(" as", 8)] },
      { candidates: [c(" a", 60), c(" the", 8)] },
      { candidates: [c(" wronged", 25), c(" wounded", 18), c(" furious", 12)] },
      { candidates: [c(" animal.", 35), c(" creature.", 20), c(" beast.", 15)] },
      // Sentence 5: "Tonight it was only muttering."
      { candidates: [c(" Tonight", 35), c(" Now", 10)] },
      { candidates: [c(" it", 65)] },
      { candidates: [c(" was", 55), c(" seemed", 15)] },
      { candidates: [c(" only", 40), c(" merely", 15), c(" just", 12)] },
      { candidates: [c(" muttering.", 35), c(" murmuring.", 15), c(" sighing.", 10)] },
      // Sentence 6: "He set the kettle on the stove and watched the beam sweep the dark water, counting the seconds between turns the way other men counted sheep."
      { candidates: [c(" He", 45), c(" She", 12)] },
      { candidates: [c(" set", 35), c(" put", 25), c(" placed", 12)] },
      { candidates: [c(" the", 60), c(" a", 10)] },
      { candidates: [c(" kettle", 40), c(" pot", 12)] },
      { candidates: [c(" on", 50), c(" over", 8)] },
      { candidates: [c(" the", 60), c(" a", 8)] },
      { candidates: [c(" stove", 40), c(" fire", 15), c(" burner", 8)] },
      { candidates: [c(" and", 50)] },
      { candidates: [c(" watched", 35), c(" eyed", 8), c(" followed", 8)] },
      { candidates: [c(" the", 60), c(" its", 8)] },
      { candidates: [c(" beam", 40), c(" light", 18), c(" ray", 8)] },
      { candidates: [c(" sweep", 30), c(" cross", 12), c(" cut", 8)] },
      { candidates: [c(" the", 60)] },
      { candidates: [c(" dark", 40), c(" black", 18), c(" dim", 8)] },
      { candidates: [c(" water,", 40), c(" sea,", 20), c(" darkness,", 8)] },
      { candidates: [c(" counting", 40), c(" measuring", 10), c(" timing", 8)] },
      { candidates: [c(" the", 60)] },
      { candidates: [c(" seconds", 40), c(" beats", 10), c(" intervals", 8)] },
      { candidates: [c(" between", 45)] },
      { candidates: [c(" turns", 35), c(" flashes", 15), c(" revolutions", 8)] },
      { candidates: [c(" the", 50), c(" a", 8)] },
      { candidates: [c(" way", 50), c(" manner", 6)] },
      { candidates: [c(" other", 40), c(" ordinary", 8)] },
      { candidates: [c(" men", 45), c(" sailors", 10), c(" folk", 6)] },
      { candidates: [c(" counted", 40), c(" measured", 8)] },
      { candidates: [c(" sheep.", 60), c(" waves.", 10), c(" stars.", 8)] },
      // Sentence 7: "The lamp needed oil, the lens needed cloth, and the logbook needed the truth of the night."
      { candidates: [c(" The", 55), c(" His", 10)] },
      { candidates: [c(" lamp", 40), c(" light", 18), c(" lantern", 10)] },
      { candidates: [c(" needed", 45), c(" wanted", 10), c(" required", 6)] },
      { candidates: [c(" oil,", 40), c(" fuel,", 12), c(" trimming,", 8)] },
      { candidates: [c(" the", 65)] },
      { candidates: [c(" lens", 40), c(" glass", 20), c(" mirror", 8)] },
      { candidates: [c(" needed", 40), c(" wanted", 8)] },
      { candidates: [c(" cloth,", 30), c(" polishing,", 12), c(" care,", 10)] },
      { candidates: [c(" and", 55)] },
      { candidates: [c(" the", 60)] },
      { candidates: [c(" logbook", 35), c(" record", 15), c(" ledger", 8)] },
      { candidates: [c(" needed", 35), c(" wanted", 8)] },
      { candidates: [c(" the", 60)] },
      { candidates: [c(" truth", 40), c(" facts", 10), c(" account", 6)] },
      { candidates: [c(" of", 70)] },
      { candidates: [c(" the", 65)] },
      { candidates: [c(" night.", 50), c(" watch.", 12), c(" hours.", 8)] },
      // Sentence 8: "He wrote the wind speed and the visibility, then hesitated over the rest."
      { candidates: [c(" He", 50), c(" Elias", 12)] },
      { candidates: [c(" wrote", 40), c(" recorded", 18), c(" entered", 8)] },
      { candidates: [c(" the", 60)] },
      { candidates: [c(" wind", 40), c(" gale", 12), c(" breeze", 8)] },
      { candidates: [c(" speed", 45), c(" force", 15)] },
      { candidates: [c(" and", 55)] },
      { candidates: [c(" the", 60)] },
      { candidates: [c(" visibility,", 40), c(" horizon,", 12), c(" fog,", 8)] },
      { candidates: [c(" then", 45), c(" and", 10)] },
      { candidates: [c(" hesitated", 30), c(" paused", 15), c(" stalled", 8)] },
      { candidates: [c(" over", 45), c(" about", 10)] },
      { candidates: [c(" the", 60)] },
      { candidates: [c(" rest.", 45), c(" details.", 12), c(" whole.", 8)] }
    ]
  },
  {
    id: "facts",
    title: "Factual passage",
    kind: "prose",
    prompt: "Tell me about Newton's most famous work.",
    blurb: "Factual continuations can be highly constrained. After 'Principia', 'Mathematica' dominates this toy distribution, leaving the tournament almost nothing to move.",
    explanation:
      "Watermark evidence accumulates where probability mass can actually be shifted. At a factual step one candidate holds ~all the mass, so the 30 tournament layers redistribute almost nothing and the sampled token carries no usable signal. Nothing special-cases this; it falls out of the math. Only the few genuinely open choices (connective words) contribute, so the evidence stays thin.",
    expected: "sparse",
    specs: [
      { candidates: [c("Isaac", 70)] },
      { candidates: [c(" Newton's", 100)] },
      { candidates: [c(" most", 45), c(" best", 20), c(" greatest", 10)] },
      { candidates: [c(" famous", 55), c(" influential", 18), c(" important", 14)] },
      { candidates: [c(" work", 90), c(" book", 10)] },
      { candidates: [c(" was", 90), c(" is", 10)] },
      { candidates: [c(" called", 45), c(" titled", 20), c(" named", 10)] },
      // The fact itself: only one right answer.
      { candidates: [c(" Principia", 100)] },
      { candidates: [c(" Mathematica", 100)] },
      { candidates: [c(" (1687).", 100)] },
      { candidates: [c(" It", 55), c(" This", 12)] },
      { candidates: [c(" laid", 20), c(" set", 16), c(" established", 14)] },
      { candidates: [c(" out", 45), c(" down", 12)] },
      { candidates: [c(" the", 90), c(" his", 10)] },
      { candidates: [c(" laws", 40), c(" foundations", 12), c(" principles", 18)] },
      { candidates: [c(" of", 80)] },
      { candidates: [c(" motion", 50), c(" mechanics", 20)] },
      { candidates: [c(" and", 55)] },
      { candidates: [c(" universal", 90), c(" Newtonian", 10)] },
      { candidates: [c(" gravitation.", 95), c(" gravity.", 5)] }
    ]
  },
  {
    id: "code",
    title: "Code (with comments)",
    kind: "code",
    prompt: "Write a function that checks if a number is prime.",
    blurb: "Code tokens are near-deterministic because the syntax has to be exact. In this snippet, only the free-form comment gives the tournament meaningful probability mass to move.",
    explanation:
      "From Anthropic's explainer: 'code—which in very many cases has to be exact—has generally less watermarking than some other forms of text.' The syntax tokens here sit in one-candidate distributions, so the update runs but moves zero mass. The comment line is ordinary prose and supplies real choices. SynthID also masks exact repeated four-token contexts, though this short trace contains none.",
    expected: "almost none",
    // Token runs are whitespace-aligned (punctuation folds into the
    // preceding run) so pasted code re-tokenizes into exactly these IDs.
    specs: [
      { candidates: [c("function", 100)] },
      { candidates: [c(" isPrime(n:", 100)] },
      { candidates: [c(" number):", 100)] },
      { candidates: [c(" boolean", 100)] },
      { candidates: [c(" {", 100)] },
      // The comment line: genuine prose, watermarkable.
      { candidates: [c("\n  //", 100)] },
      { candidates: [c(" Trial", 30), c(" Simple", 22), c(" Naive", 10)] },
      { candidates: [c(" division", 55), c(" check", 12)] },
      { candidates: [c(" is", 30), c(" works", 8), c(" runs", 6)] },
      { candidates: [c(" good", 14), c(" fast", 10), c(" fine", 10)] },
      { candidates: [c(" enough", 40), c(" here", 8)] },
      { candidates: [c(" for", 40), c(" at", 8)] },
      { candidates: [c(" small", 30), c(" typical", 14), c(" modest", 8)] },
      { candidates: [c(" inputs", 40), c(" numbers", 25)] },
      { candidates: [c("\n  if", 100)] },
      { candidates: [c(" (n", 100)] },
      { candidates: [c(" <", 100)] },
      { candidates: [c(" 2)", 100)] },
      { candidates: [c(" return", 100)] },
      { candidates: [c(" false;", 100)] },
      { candidates: [c("\n  for", 100)] },
      { candidates: [c(" (let", 100)] },
      { candidates: [c(" i", 100)] },
      { candidates: [c(" =", 100)] },
      { candidates: [c(" 2;", 100)] },
      { candidates: [c(" i", 100)] },
      { candidates: [c(" *", 100)] },
      { candidates: [c(" i", 100)] },
      { candidates: [c(" <=", 100)] },
      { candidates: [c(" n;", 100)] },
      { candidates: [c(" i++)", 100)] },
      { candidates: [c(" {", 100)] },
      { candidates: [c("\n    if", 100)] },
      { candidates: [c(" (n", 100)] },
      { candidates: [c(" %", 100)] },
      { candidates: [c(" i", 100)] },
      { candidates: [c(" ===", 100)] },
      { candidates: [c(" 0)", 100)] },
      { candidates: [c(" return", 100)] },
      { candidates: [c(" false;", 100)] },
      { candidates: [c("\n  }", 100)] },
      { candidates: [c("\n  return", 100)] },
      { candidates: [c(" true;", 100)] },
      { candidates: [c("\n}", 100)] }
    ]
  },
  {
    id: "quote",
    title: "Quotation",
    kind: "quote",
    prompt: "Quote the opening of A Tale of Two Cities.",
    blurb: "A quotation has one exact form. Every step offers a single token, so the tournament has nothing to move and the text carries no evidence.",
    explanation:
      "Quoting means reproducing someone else's exact words, so every step offers one candidate. The update still runs, since nothing here is special-cased, but it has zero mass to move. The passage is long enough for a real verdict (about 30 scored ngrams), and the verdict is still 'no signal': plenty of evidence, none of it agreeing with the key. The repetition mask also removes the repeated 'it was the age of' contexts, thinning an already empty signal further.",
    expected: "none",
    specs: [
      { candidates: [c('"', 100)] },
      { candidates: [c(" It", 100)] },
      { candidates: [c(" was", 100)] },
      { candidates: [c(" the", 100)] },
      { candidates: [c(" best", 100)] },
      { candidates: [c(" of", 100)] },
      { candidates: [c(" times,", 100)] },
      { candidates: [c(" it", 100)] },
      { candidates: [c(" was", 100)] },
      { candidates: [c(" the", 100)] },
      { candidates: [c(" worst", 100)] },
      { candidates: [c(" of", 100)] },
      { candidates: [c(" times.", 100)] },
      { candidates: [c(" it", 100)] },
      { candidates: [c(" was", 100)] },
      { candidates: [c(" the", 100)] },
      { candidates: [c(" age", 100)] },
      { candidates: [c(" of", 100)] },
      { candidates: [c(" wisdom,", 100)] },
      { candidates: [c(" it", 100)] },
      { candidates: [c(" was", 100)] },
      { candidates: [c(" the", 100)] },
      { candidates: [c(" age", 100)] },
      { candidates: [c(" of", 100)] },
      { candidates: [c(" foolishness,", 100)] },
      { candidates: [c(" it", 100)] },
      { candidates: [c(" was", 100)] },
      { candidates: [c(" the", 100)] },
      { candidates: [c(" epoch", 100)] },
      { candidates: [c(" of", 100)] },
      { candidates: [c(" belief,", 100)] },
      { candidates: [c(" it", 100)] },
      { candidates: [c(" was", 100)] },
      { candidates: [c(" the", 100)] },
      { candidates: [c(" epoch", 100)] },
      { candidates: [c(" of", 100)] },
      { candidates: [c(" incredulity,", 100)] },
      { candidates: [c(' "', 100)] }
    ]
  },
  {
    id: "proofread",
    title: "Proofreading human text",
    kind: "prose",
    prompt:
      "Fix the grammar in this text, change nothing else: 'The team were proud of there result because they worked hardly all year. The manager, who have watched every milestone, said the effort were worth it, and nobody have complained since.'",
    blurb: "Claude only edits a handful of words in someone else's writing. The watermark can only attach to those corrections.",
    explanation:
      "From the explainer: when Claude proofreads, 'nearly all the words are the person's, there's very little (if anything) for the watermark to attach to.' Each original word sits in a distribution peaked at the echo of the input, so the tournament barely moves anything there; only the corrections are genuinely open choices, and grammar fixes rarely offer equally good alternatives. The passage is long enough for a real verdict (about 27 scored ngrams), and the verdict stays 'no signal': the person's words carry nothing, and six small corrections are too few to register.",
    expected: "little to none",
    specs: [
      { candidates: [c("The", 100)] },
      { candidates: [c(" team", 100)] },
      { candidates: [c(" was", 60), c(" were", 30)] },
      { candidates: [c(" proud", 100)] },
      { candidates: [c(" of", 100)] },
      { candidates: [c(" their", 90), c(" there", 5)] },
      { candidates: [c(" result", 100)] },
      { candidates: [c(" because", 100)] },
      { candidates: [c(" they", 100)] },
      { candidates: [c(" worked", 100)] },
      { candidates: [c(" hard", 60), c(" hardly", 5)] },
      { candidates: [c(" all", 100)] },
      { candidates: [c(" year.", 100)] },
      { candidates: [c(" The", 100)] },
      { candidates: [c(" manager,", 100)] },
      { candidates: [c(" who", 100)] },
      { candidates: [c(" has", 60), c(" have", 30)] },
      { candidates: [c(" watched", 100)] },
      { candidates: [c(" every", 100)] },
      { candidates: [c(" milestone,", 100)] },
      { candidates: [c(" said", 100)] },
      { candidates: [c(" the", 100)] },
      { candidates: [c(" effort", 100)] },
      { candidates: [c(" was", 60), c(" were", 30)] },
      { candidates: [c(" worth", 100)] },
      { candidates: [c(" it,", 100)] },
      { candidates: [c(" and", 100)] },
      { candidates: [c(" nobody", 100)] },
      { candidates: [c(" has", 60), c(" have", 30)] },
      { candidates: [c(" complained", 100)] },
      { candidates: [c(" since.", 100)] }
    ]
  },
  {
    id: "translation",
    title: "Translation",
    kind: "prose",
    prompt:
      "Translate into English: « Le vent se lève, il faut tenter de vivre. Les années ont fui, et la mer reste. Chaque matin, le gardien ouvre la porte de la tour et regarde l'horizon. Il attend un navire qui ne viendra peut-être jamais. Mais il veille quand même, car veiller est la seule prière du gardien. L'horizon reste vide, pourtant le gardien allume la lampe chaque soir. Il faut bien que quelqu'un garde la lumière allumée, même pour les navires qui ne viendront jamais. Demain, le brouillard reviendra, et le gardien sera là. »",
    blurb: "Every word of a translation is chosen by the model, so a translation carries a full watermark.",
    explanation:
      "Anthropic says it directly: 'A translation produced by Claude carries a watermark, because in this case every word is chosen by Claude.' Rendering a sentence in another language means making a genuine choice at nearly every step, on open distributions with movable mass, so the signal builds quickly.",
    expected: "dense",
    specs: [
      // "The wind is rising; one must try to live."
      { candidates: [c("The", 55), c("A", 12)] },
      { candidates: [c(" wind", 55), c(" breeze", 8)] },
      { candidates: [c(" is", 35), c(" rises", 10)] },
      { candidates: [c(" rising;", 40), c(" rising,", 15), c(" up;", 6)] },
      { candidates: [c(" we", 28), c(" one", 20)] },
      { candidates: [c(" must", 35), c(" should", 10)] },
      { candidates: [c(" try", 40), c(" endeavor", 8), c(" attempt", 10)] },
      { candidates: [c(" to", 75)] },
      { candidates: [c(" live.", 65), c(" survive.", 8)] },
      // "The years have fled, and the sea remains."
      { candidates: [c(" The", 45), c(" All", 8)] },
      { candidates: [c(" years", 45), c(" seasons", 10)] },
      { candidates: [c(" have", 40)] },
      { candidates: [c(" fled,", 40), c(" passed,", 15), c(" flown,", 8)] },
      { candidates: [c(" and", 50)] },
      { candidates: [c(" the", 55), c(" that", 6)] },
      { candidates: [c(" sea", 50), c(" ocean", 12)] },
      { candidates: [c(" remains.", 45), c(" stays.", 15), c(" endures.", 10)] },
      // "Every morning, the keeper opens the tower door and watches the horizon."
      { candidates: [c(" Every", 45), c(" Each", 25)] },
      { candidates: [c(" morning,", 50), c(" day,", 8)] },
      { candidates: [c(" the", 55), c(" that", 6)] },
      { candidates: [c(" keeper", 40), c(" watchman", 12), c(" warden", 8)] },
      { candidates: [c(" opens", 40), c(" unlatches", 6)] },
      { candidates: [c(" the", 55)] },
      { candidates: [c(" tower", 40), c(" door", 12)] },
      { candidates: [c(" door", 45)] },
      { candidates: [c(" and", 50)] },
      { candidates: [c(" watches", 35), c(" scans", 15), c(" gazes", 10)] },
      { candidates: [c(" at", 45), c(" toward", 8)] },
      { candidates: [c(" the", 55)] },
      { candidates: [c(" horizon.", 50), c(" skyline.", 8), c(" distance.", 8)] },
      // "He waits for a ship that may never come."
      { candidates: [c(" He", 55), c(" She", 8)] },
      { candidates: [c(" waits", 45), c(" watches", 8)] },
      { candidates: [c(" for", 55), c(" on", 6)] },
      { candidates: [c(" a", 55), c(" the", 8)] },
      { candidates: [c(" ship", 45), c(" vessel", 15), c(" boat", 10)] },
      { candidates: [c(" that", 50), c(" which", 10)] },
      { candidates: [c(" may", 35), c(" might", 20), c(" perhaps", 8)] },
      { candidates: [c(" never", 45), c(" not", 8)] },
      { candidates: [c(" come.", 45), c(" arrive.", 15), c(" appear.", 10)] },
      // "But he watches anyway, because watching is the keeper's only prayer."
      { candidates: [c(" But", 45), c(" Yet", 18), c(" Still,", 8)] },
      { candidates: [c(" he", 55), c(" Elias", 8)] },
      { candidates: [c(" watches", 40), c(" waits", 12), c(" remains", 8)] },
      { candidates: [c(" anyway,", 35), c(" regardless,", 10), c(" on,", 8)] },
      { candidates: [c(" because", 40), c(" since", 10)] },
      { candidates: [c(" watching", 35), c(" vigil", 10)] },
      { candidates: [c(" is", 55)] },
      { candidates: [c(" the", 55), c(" a", 10)] },
      { candidates: [c(" keeper's", 35), c(" watcher's", 8)] },
      { candidates: [c(" only", 40), c(" sole", 12)] },
      { candidates: [c(" prayer.", 35), c(" duty.", 12), c(" hope.", 10)] },
      // "The horizon stays empty, yet the keeper lights the lamp each evening."
      { candidates: [c(" The", 55), c(" Yet", 8)] },
      { candidates: [c(" horizon", 45), c(" sea", 15), c(" water", 8)] },
      { candidates: [c(" stays", 35), c(" remains", 15), c(" lies", 8)] },
      { candidates: [c(" empty,", 35), c(" silent,", 12), c(" bare,", 8)] },
      { candidates: [c(" yet", 30), c(" but", 18), c(" and", 8)] },
      { candidates: [c(" the", 55)] },
      { candidates: [c(" keeper", 40), c(" watcher", 10), c(" man", 8)] },
      { candidates: [c(" lights", 40), c(" kindles", 10), c(" trims", 8)] },
      { candidates: [c(" the", 60)] },
      { candidates: [c(" lamp", 45), c(" lantern", 12), c(" beacon", 8)] },
      { candidates: [c(" each", 45), c(" every", 20)] },
      { candidates: [c(" evening.", 40), c(" dusk.", 12), c(" nightfall.", 8)] },
      // "Someone must keep the light burning, even for ships that never come."
      { candidates: [c(" Someone", 40), c(" Somebody", 12), c(" He", 8)] },
      { candidates: [c(" must", 50), c(" should", 10)] },
      { candidates: [c(" keep", 45), c(" hold", 8)] },
      { candidates: [c(" the", 60)] },
      { candidates: [c(" light", 50), c(" flame", 12), c(" fire", 8)] },
      { candidates: [c(" burning,", 40), c(" alive,", 10), c(" lit,", 10)] },
      { candidates: [c(" even", 35), c(" perhaps", 8)] },
      { candidates: [c(" for", 55)] },
      { candidates: [c(" ships", 40), c(" vessels", 12), c(" sailors", 8)] },
      { candidates: [c(" that", 50), c(" which", 10)] },
      { candidates: [c(" never", 50), c(" rarely", 10)] },
      { candidates: [c(" come.", 50), c(" arrive.", 12), c(" return.", 8)] },
      // "Tomorrow, the fog will return, and the keeper will be there."
      { candidates: [c(" Tomorrow,", 45), c(" At", 12), c(" Next,", 8)] },
      { candidates: [c(" the", 45), c(" dawn's", 10)] },
      { candidates: [c(" fog", 35), c(" mist,", 18), c(" wind,", 12)] },
      { candidates: [c(" will", 35), c(" shall", 10), c(" must", 8)] },
      { candidates: [c(" return,", 35), c(" come", 12), c(" gather", 10)] },
      { candidates: [c(" and", 45)] },
      { candidates: [c(" the", 45)] },
      { candidates: [c(" keeper", 35), c(" watchman", 10), c(" man", 8)] },
      { candidates: [c(" will", 35), c(" shall", 10)] },
      { candidates: [c(" be", 40)] },
      { candidates: [c(" there.", 40), c(" waiting.", 12), c(" ready.", 8)] }
    ]
  }
];
