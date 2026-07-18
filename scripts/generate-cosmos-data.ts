/**
 * ChatCosmos — Demo Data Generator
 * --------------------------------
 * Produces a synthetic but realistic `cosmos-data.json` dataset so the 3D
 * galaxy renders immediately without needing the Python ML pipeline.
 *
 * Generates ~3,600 chat "nodes" across 18 topic clusters, assigns each a
 * 3D coordinate arranged into a galaxy-disk distribution, and writes a
 * minified JSON file to public/data/cosmos-data.json.
 *
 * Run:  bun run scripts/generate-cosmos-data.ts
 */
import fs from "fs";
import path from "path";

// ---------------------------------------------------------------------------
// Seeded RNG (mulberry32) — deterministic output for reproducible builds
// ---------------------------------------------------------------------------
function mulberry32(seed: number) {
  let a = seed >>> 0;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rand = mulberry32(42);
const randRange = (min: number, max: number) => min + rand() * (max - min);
const randInt = (min: number, max: number) => Math.floor(randRange(min, max + 1));
const pick = <T,>(arr: T[]): T => arr[Math.floor(rand() * arr.length)];
const gauss = () => {
  // Box-Muller
  let u = 0,
    v = 0;
  while (u === 0) u = rand();
  while (v === 0) v = rand();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
};

// ---------------------------------------------------------------------------
// Topic definitions — each with question & answer templates
// ---------------------------------------------------------------------------
interface Topic {
  label: string;
  keywords: string[];
  color: string;
  questions: string[];
  answers: string[];
}

const TOPICS: Topic[] = [
  {
    label: "Programming",
    keywords: ["react", "typescript", "python", "debug", "api", "git", "database"],
    color: "#22d3ee",
    questions: [
      "How do I fix a useEffect infinite loop in React when my dependency array keeps changing?",
      "What's the difference between useMemo and useCallback, and when should I use each?",
      "How can I type a function that returns a tuple in TypeScript without inference issues?",
      "Why is my Python asyncio event loop blocking on a synchronous call?",
      "How do I structure a REST API for a nested resource like users/{id}/posts/{postId}?",
      "What's the cleanest way to handle errors in async/await without try/catch everywhere?",
      "How do I squash the last 5 commits in git into one clean commit?",
      "My PostgreSQL query is slow on a large table — how do I read EXPLAIN ANALYZE?",
      "How do I debounce an input in React without re-rendering the whole component tree?",
      "What's the best way to share state between sibling components in React?",
      "How do I configure CORS properly for a Next.js API route calling an external service?",
      "Why does my Docker build cache keep invalidating when I copy package.json?",
      "How do I implement pagination with cursors instead of OFFSET in SQL?",
      "What's the difference between interface and type in TypeScript for object shapes?",
      "How do I test a component that uses useReducer with complex state transitions?",
      "How can I prevent memory leaks when subscribing to an event emitter in Node?",
      "What's the idiomatic way to handle optional chaining with array access in TS?",
      "How do I set up a monorepo with pnpm workspaces and shared TypeScript config?",
    ],
    answers: [
      "The infinite loop usually happens when the effect updates state that's also in its dependency array. Move the unstable value into a ref, or restructure so the effect only depends on truly primitive values. You can also guard the setState with a comparison check.",
      "useMemo memoizes a computed value; useCallback memoizes a function reference. Use useMemo when an expensive calculation would re-run needlessly, and useCallback when passing a callback to a memoized child to prevent its re-render.",
      "Add an explicit return type annotation: `function foo(): [string, number]`. Without it, TS widens to a union array. For const assertions, `as const` also works but makes the tuple readonly.",
      "A synchronous call inside a coroutine blocks the entire event loop. Offload it with `await loop.run_in_executor(None, blocking_fn)` or use an async-native library like `aiofiles` or `httpx`.",
      "Nest the routes: `/users/:userId/posts/:postId`. Keep controllers thin — delegate to a service layer. Use resource names in plural, lowercase, kebab-case. Version with `/v1/` prefix when the API is public.",
      "Create a helper `to<T>(promise)` that resolves to `[err, data] | [null, T]`. Or use Result/Either types. For app-level boundaries, a global error boundary plus `handleAsync` wrappers keeps handlers clean.",
      "Use interactive rebase: `git rebase -i HEAD~5`, mark the first as `pick` and the rest as `squash`, then edit the combined commit message. Save and you'll have one clean commit.",
      "Look for `Seq Scan` on large tables (bad — needs an index), high `rows` estimates vs actual (stale stats — run ANALYZE), and `Nested Loop` with huge outer rows. Add a B-tree index on filtered/joined columns and re-run.",
      "Use a debounced state updater: store the raw input locally, but update a debounced 'search term' that triggers the fetch. `useDeferredValue` also works for keeping the input responsive while the expensive render is deferred.",
      "Lift state to the nearest common parent, or use a context provider. For complex apps, a store like Zustand or Redux keeps siblings decoupled. Avoid prop-drilling more than two levels.",
      "Set `Access-Control-Allow-Origin` to the specific origin, allow only the methods and headers you need, and handle preflight `OPTIONS` requests. For credentials, set `credentials: true` and a non-wildcard origin.",
      "Copy package.json and lockfile first, run `npm install`, THEN copy source. This layer-caching trick means source changes don't bust the dependency layer. Use a `.dockerignore` to skip node_modules.",
      "Cursor pagination uses a 'where id > lastId' clause with a LIMIT. It's stable under inserts and faster than OFFSET for deep pages. Encode the cursor as base64 to keep it opaque to clients.",
      "Both work for object shapes. `interface` is extendable via declaration merging and shows better error messages. `type` supports unions and intersections. Prefer `interface` for objects you expect to extend, `type` for unions.",
      "Test the reducer in isolation first — pure functions are easy to unit test. For the component, use `@testing-library/react` and assert on rendered state after dispatching actions through user events.",
      "Always return a cleanup function from useEffect that removes the listener. For long-lived subscriptions, store them in a ref and dispose in the cleanup. Use AbortController for fetches.",
      "Optional chaining short-circuits: `arr?.[0]` returns undefined if arr is nullish. For arrays, check length: `arr?.[0] ?? defaultValue`. Avoid chaining too deep — extract intermediate variables for readability.",
      "Create a `pnpm-workspace.yaml` listing packages/*, put shared tsconfig in the root, extend it in each package with `extends`. Use `catalog:` for syncing dependency versions across packages.",
    ],
  },
  {
    label: "AI & Machine Learning",
    keywords: ["neural", "training", "transformer", "embedding", "fine-tune", "prompt", "dataset"],
    color: "#a78bfa",
    questions: [
      "What's the intuition behind attention in transformer models?",
      "How do I choose between fine-tuning and retrieval-augmented generation?",
      "Why does my model overfit the training set but generalize poorly?",
      "What's the difference between batch normalization and layer normalization?",
      "How do I build a vector search index for a million documents?",
      "What makes a good prompt for chain-of-thought reasoning?",
      "How do I handle class imbalance in a classification dataset?",
      "What's the tradeoff between model size and inference latency?",
      "How do embeddings capture semantic similarity between sentences?",
      "Why is gradient clipping important when training RNNs and transformers?",
      "How do I evaluate a retrieval pipeline beyond just recall@k?",
      "What's the role of the learning rate warmup schedule?",
      "How do I detect and mitigate bias in a text classification model?",
      "What's the difference between supervised and self-supervised pretraining?",
      "How do I quantize a model to reduce its memory footprint?",
    ],
    answers: [
      "Attention lets each token weigh every other token by relevance. Query, key, and value vectors are computed; the softmax of query·key scores gives weights, and the weighted sum of values is the output. This lets the model focus on context dynamically.",
      "Fine-tune when the task has a stable, narrow distribution and you have labeled data. Use RAG when knowledge changes often or you need citations. They compose — fine-tune the model's style and use RAG for facts.",
      "Overfitting means the model memorized noise. Add regularization (dropout, weight decay), get more data, use early stopping, or reduce model capacity. Check that your validation set is truly held out.",
      "Batch norm normalizes across the batch dimension per feature; layer norm normalizes across features per sample. Layer norm is preferred in transformers because it's batch-size independent and works for variable-length sequences.",
      "Use HNSW (hierarchical navigable small world) via FAISS or a vector DB like pgvector, Qdrant, or Pinecone. For a million docs, HNSW gives sub-millisecond queries. Build the index offline, then serve read replicas.",
      "Ask the model to reason step by step before answering: 'Let's think through this carefully.' Provide a worked example of the reasoning format. Break complex problems into sub-questions. Lower temperature for factual chains.",
      "Try class weights in the loss function, oversample minority classes, or use SMOTE for tabular data. For severe imbalance, focal loss down-weights easy examples. Always evaluate with precision, recall, and F1 per class, not accuracy.",
      "Bigger models capture more patterns but need more memory and compute per token. Distillation can transfer a big model's knowledge to a smaller, faster one. Quantization and pruning cut latency at a small quality cost.",
      "Embeddings map text to a point in high-dimensional space where semantic similarity becomes geometric proximity. Trained contrastively, paraphrases land close together. Cosine similarity between vectors approximates meaning overlap.",
      "Without clipping, exploding gradients destabilize training — loss spikes to NaN. Clipping caps the gradient norm to a max value, stabilizing the update. Essential for deep or recurrent architectures with long-range dependencies.",
      "Beyond recall@k, measure MRR and NDCG for ranking quality, check diversity to avoid redundant results, and measure end-to-end answer correctness with a held-out set. Latency and cost per query matter in production.",
      "Warmup gradually increases the learning rate at the start, preventing early instability when weights are random. It stabilizes the first updates, especially with large batch sizes and adaptive optimizers. Then decay schedules refine convergence.",
      "Audit the dataset for representation gaps across demographics. Measure per-group metrics (TPR, FPR). Use counterfactual data augmentation or balanced sampling. Document limitations. Bias mitigation is iterative, never 'solved.'",
      "Supervised pretraining uses labeled pairs (image→label). Self-supervised creates labels from the data itself — next-token prediction, masked language modeling, contrastive pairs. Self-supervised scales because it needs no human labels.",
      "Post-training quantization converts weights from FP16 to INT8 or INT4, cutting memory 2-4x with modest accuracy loss. Use GPTQ or AWQ for best results. Some runtimes support on-the-fly quantization with minimal quality drop.",
    ],
  },
  {
    label: "Creative Writing",
    keywords: ["story", "character", "plot", "dialogue", "narrative", "scene", "metaphor"],
    color: "#f472b6",
    questions: [
      "How do I write a villain the reader secretly roots for?",
      "What's a good way to show a character's grief without saying 'she was sad'?",
      "How can I make my dialogue sound natural and not on-the-nose?",
      "What's the difference between a plot twist and a deus ex machina?",
      "How do I pace a slow-burn romance without losing the reader's interest?",
      "What makes a good opening line for a fantasy novel?",
      "How do I world-build without dumping exposition on the reader?",
      "What's the best way to handle a time skip in a story?",
      "How do I write a morally grey protagonist convincingly?",
      "What's a reliable structure for a short story?",
      "How do I make my prose more vivid without overusing adjectives?",
      "What's the difference between voice and style in fiction?",
      "How do I write a compelling flashback that doesn't kill momentum?",
      "What makes dialogue tags effective vs distracting?",
    ],
    answers: [
      "Give the villain a understandable motive and a personal code they never break. Let them be right about something the hero is wrong about. Show them being kind to someone. The reader roots for consistency and conviction, even in evil.",
      "Use concrete actions and sensory detail: she kept washing the same cup, left his shoes by the door for weeks, flinched at his name on the radio. Grief lives in avoidance and ritual, not in the word 'sad.' Show the shape of the absence.",
      "Let characters interrupt, talk past each other, and leave things unsaid. Cut pleasantries. People rarely say exactly what they mean. Subtext — saying one thing while meaning another — is where the real drama lives.",
      "A twist recontextualizes clues already planted; the reader feels it was inevitable. Deus ex machina introduces an outside force that solves the problem without setup. Twists reward attention; cheats betray it.",
      "Vary the stakes: small moments of intimacy punctuate the distance. Give each scene a reason to exist beyond the romance — a shared problem, a contradiction. Slow burns need tension and progress, not just delay.",
      "Start in motion, with a specific image that raises a question. Avoid weather, dreams, or waking up. 'The cartographer's daughter drew the last map of a country that no longer existed' — a place, a person, a loss, a mystery.",
      "Reveal the world through the characters' reactions and needs, not narrator explanation. A character who curses the local god tells us more than a paragraph on theology. Let details emerge where they matter to the action.",
      "Mark it clearly with a sensory or temporal anchor: 'Three winters later.' Skip to a scene that re-establishes stakes. Show what changed and what didn't. Avoid summarizing the gap — let the reader infer from details.",
      "Give them a goal the reader shares, then a method that's questionable. Let them fail at being good and succeed at being effective. Show the cost of their compromises on people they love. Morally grey is about trade-offs, not cruelty.",
      "Try the MICE stack: Milieu, Inquiry, Character, Event. Or the classic arc: status quo, inciting incident, rising action, climax, resolution. Short stories often work best with one thread and a single turning point.",
      "Use strong verbs and specific nouns. 'He stormed in' beats 'he walked in angrily.' Cut adjectives that repeat what the verb already shows. One precise image outweighs three vague ones. Read it aloud — weak prose stumbles.",
      "Style is the surface — word choice, sentence rhythm, imagery. Voice is the underlying personality — the sensibility that chooses what to notice and how to feel about it. Two writers can share a style but never a voice.",
      "Enter the flashback through a specific trigger (a smell, an object), keep it in-scene not summary, and exit on a line that returns us to the present with new weight. Keep it short and make sure it changes how we see the now.",
      "Use 'said' mostly — it's invisible. Vary tags only when the verb adds real meaning ('whispered,' 'lied'). Action beats often work better than tags: 'She set down the gun. \"Leave.\"' Avoid adverb tags — they tell what dialogue should show.",
    ],
  },
  {
    label: "Science & Physics",
    keywords: ["quantum", "relativity", "energy", "particle", "thermodynamics", "gravity", "wave"],
    color: "#34d399",
    questions: [
      "What does quantum entanglement actually mean in plain language?",
      "Why is the speed of light the cosmic speed limit?",
      "What's the difference between heat and temperature?",
      "How does general relativity explain gravity differently from Newton?",
      "What is dark matter, and how do we know it exists?",
      "Why don't electrons fall into the nucleus if opposites attract?",
      "What's the uncertainty principle really saying?",
      "How does a black hole's event horizon work?",
      "What's the difference between fission and fusion?",
      "Why is entropy always increasing?",
      "How do we know the universe is expanding?",
      "What is wave-particle duality?",
      "How does the double-slit experiment reveal quantum weirdness?",
    ],
    answers: [
      "Two particles can be linked so that measuring one instantly determines the other's state, no matter the distance. It's not information traveling faster than light — it's that their properties were correlated in a way that has no classical analog. Einstein called it 'spooky action.'",
      "Special relativity shows that as anything with mass accelerates toward c, its energy approaches infinity. Light moves at c because it's massless. The speed limit emerges from the geometry of spacetime — it's the conversion factor between space and time.",
      "Heat is the total kinetic energy of all molecules in a substance. Temperature is the average kinetic energy per molecule. A bathtub and a sparkler can be the same temperature, but the bathtub holds far more heat because it has vastly more molecules.",
      "Newton saw gravity as a force pulling masses together. Einstein saw it as the curvature of spacetime caused by mass — objects follow the straightest possible path through curved spacetime, which we experience as falling. It predicts light bending and time dilation.",
      "Dark matter is unseen mass whose gravity holds galaxies together. We infer it from galaxy rotation speeds (too fast for visible mass), gravitational lensing, and the cosmic microwave background. It doesn't emit or absorb light — we only see its gravitational pull.",
      "Quantum mechanics forbids it. An electron is described by a wavefunction; confining it to the tiny nucleus would require enormous momentum (and energy) by the uncertainty principle. It settles into orbitals — probability clouds — at specific energy levels, not a crash orbit.",
      "You can't simultaneously know a particle's exact position and momentum. It's not a measurement flaw — it's fundamental. A wave with a precise position is a pulse of many frequencies (momenta), and vice versa. Nature is fuzzy at the bottom.",
      "The event horizon is the boundary where escape velocity exceeds c. Once crossed, no path leads outward — even light's 'straight' path curves inward. To an outside observer, infalling matter appears to freeze and redshift at the horizon; the infaller notices nothing special locally.",
      "Fission splits heavy nuclei (uranium) into lighter ones, releasing energy — used in current reactors. Fusion combines light nuclei (hydrogen isotopes) into heavier ones, releasing even more energy — powers the sun and experimental reactors. Fusion is cleaner but harder to sustain.",
      "Entropy measures the number of microscopic arrangements consistent with a macroscopic state. Systems evolve toward more probable (higher-entropy) configurations simply because there are vastly more of them. The arrow of time is statistical, not fundamental.",
      "Distant galaxies' light is redshifted — stretched to longer wavelengths — proportional to their distance, meaning they're receding. The cosmic microwave background is the afterglow of the hot early universe. Together they show space itself is expanding over time.",
      "Quantum objects behave like both waves and particles depending on how they're observed. An electron interferes with itself like a wave going through two slits, yet is detected as a discrete particle. The wavefunction gives probabilities; measurement collapses it to a definite outcome.",
      "Send single particles through two slits onto a screen. Even one at a time, an interference pattern (a wave signature) builds up. But if you detect which slit each goes through, the pattern vanishes — observation changes the outcome. Measurement and reality are intertwined.",
    ],
  },
  {
    label: "Philosophy & Ethics",
    keywords: ["consciousness", "morality", "ethics", "meaning", "free-will", "virtue", "justice"],
    color: "#fb7185",
    questions: [
      "Is free will compatible with a deterministic universe?",
      "What's the trolley problem really testing about morality?",
      "How does utilitarianism differ from deontological ethics?",
      "What is the hard problem of consciousness?",
      "Can morality exist without religion?",
      "What did Nietzsche mean by 'God is dead'?",
      "Is it ever ethical to lie?",
      "What's the difference between knowledge and true belief?",
      "Does the self persist over time, or is it an illusion?",
      "What is justice according to Rawls?",
      "Are we morally responsible for unintended consequences?",
      "What's the meaning of life if there's no inherent purpose?",
    ],
    answers: [
      "Compatibilists argue yes: free will is acting according to your own reasons without coercion, even if those reasons are causally determined. Libertarians insist true freedom requires indeterminism. The debate hinges on whether 'could have done otherwise' means counterfactual possibility or metaphysical openness.",
      "It tests whether you'd actively cause harm to prevent greater harm — the conflict between action and omission, and between utilitarian counting and the sanctity of treating people as means. Variants (fat man, loop) probe how much the nature of the act, not just the outcome, matters to intuition.",
      "Utilitarianism judges actions by consequences — maximize overall happiness. Deontology judges by duties and rules — some acts are wrong regardless of outcome (lying, killing the innocent). They diverge when a bad act would produce good results.",
      "The 'easy' problems explain cognitive functions — attention, integration, reportability. The hard problem, as Chalmers frames it, is why there's subjective experience at all — why it feels like something to see red. Explaining mechanism doesn't obviously explain phenomenal experience.",
      "Yes — secular ethics grounds morality in well-being, flourishing, reason, and empathy. Euthyphro's dilemma challenges divine command: is something good because God commands it (then morality is arbitrary) or does God command it because it's good (then goodness is independent)?",
      "Not a boast but a diagnosis: the Enlightenment eroded the theological foundation of Western values, and we haven't yet replaced it. The danger is nihilism; the opportunity is to create new values. He warns we must become worthy of having killed God.",
      "Kant said no — lying violates a categorical imperative. Utilitarians say yes if it prevents greater harm. Virtue ethics asks what an honest person would do in context. Most agree white lies to protect the innocent can be justified, but the slope is real.",
      "Knowledge, since Plato, is justified true belief — you believe it, it's true, and you have good reasons. Gettier cases challenge this: a justified true belief based on luck isn't knowledge. Epistemologists still debate what extra condition closes the gap.",
      "Psychological continuity views say the self persists as long as memories and psychology connect. Bundle theorists (Hume) say there's no underlying self, just a stream of experiences. The question matters for identity, responsibility, and what survival even means.",
      "Rawls' justice as fairness: design society's rules from behind a 'veil of ignorance' where you don't know your place. Rational people would choose equal basic liberties and allow inequalities only if they benefit the least advantaged. It balances liberty and equity.",
      "Intention matters — we judge attempted harm differently from accidental harm. But we're still responsible for foreseeable side effects and for negligence. Moral luck complicates it: two drunk drivers, one hits a child, one doesn't — same act, different blame.",
      "Existentialists like Sartre and Camus say meaning isn't given, it's made. Acknowledging absurdity — the mismatch between our craving for meaning and a silent universe — can be liberating. We author values through choice and commitment. The meaning is the one you create.",
    ],
  },
  {
    label: "Cooking & Recipes",
    keywords: ["recipe", "sauce", "bake", "seasoning", "technique", "ingredient", "flavor"],
    color: "#fb923c",
    questions: [
      "How do I make a pan sauce after searing a steak?",
      "What's the secret to a crispy roast potato?",
      "How do I balance a vinaigrette that's too acidic?",
      "Why does my bread not rise properly?",
      "What's the difference between sweating and sautéing onions?",
      "How do I properly temper chocolate?",
      "What makes a good stock versus a broth?",
      "How do I fix a broken hollandaise sauce?",
      "What's the maillard reaction and why does it matter?",
      "How do I season a cast iron pan correctly?",
      "Why should I salt eggplant before cooking it?",
      "How do I get a good sear on fish without it sticking?",
    ],
    answers: [
      "After searing, pour off excess fat, lower heat, add shallots and deglaze with wine or stock, scraping the fond. Reduce by half, swirl in cold butter off heat for a glossy emulsion, season, and finish with herbs. The browned bits are the flavor.",
      "Parboil cut potatoes in salted water until edges soften, drain and shake to rough up the surface, then roast at 220°C in plenty of hot fat (goose or duck is best). The starchy fuzz crisps into a glass-like crust. Don't crowd the pan.",
      "Add fat — more oil softens the acid's edge. A pinch of sugar or honey rounds it. A tiny dash of water dilutes without dulling. Taste as you go; the goal is bright but not sharp. Mustard helps emulsify and adds depth.",
      "Likely culprits: yeast is dead (test in warm water with sugar — should foam in 10 min), liquid too hot (kills yeast above 43°C), not enough kneading (gluten weak), or too cold a proof. Use a warm spot and give it time.",
      "Sweating is low heat, covered, until soft and translucent — no browning, draws out sweetness. Sautéing is higher heat, uncovered, with browning for deeper flavor. Sweated onions disappear into a sauce; sautéed ones stand out.",
      "Melt chocolate to ~45°C, then cool to ~27°C by adding chopped unmelted chocolate, then warm slightly to ~32°C. This aligns the cocoa butter crystals (type V) for a snap and gloss. Skip tempering and it blooms white and soft.",
      "Stock uses bones (roasted for dark stock) simmered long to extract gelatin and collagen — it's body-rich, often unseasoned. Broth uses meat and is seasoned and ready to eat. Stock is a building block; broth is a finished soup base.",
      "It split because the butter cooled too fast or was added too quickly. Start a fresh yolk with a teaspoon of warm water, then whisk in the broken sauce drop by drop — it re-emulsifies. Or blend in a hot splash of water.",
      "Maillard is the browning reaction between amino acids and sugars above ~140°C — it creates hundreds of flavor compounds, the savory crust on bread, meat, and coffee. It's why searing tastes different from boiling. Dry surfaces brown faster.",
      "Scrub off rust, heat the pan, rub in a thin layer of neutral oil, wipe almost all of it off, bake upside-down at 230°C for an hour, repeat 2-3 times. The oil polymerizes into a hard black nonstick layer. Avoid soap until seasoned.",
      "Salt draws out bitter juices and collapses the spongy structure so it absorbs less oil when fried. Slice, salt generously, wait 30 min, rinse, and pat dry. The result is creamier interior and less greasy exterior.",
      "Pat the fish bone-dry, heat the pan until oil shimmers, lay it skin-side down and press flat for 10 seconds, then don't touch it until it releases naturally when crisp — about 4 minutes. Flip only for the last minute. Patience prevents sticking.",
    ],
  },
  {
    label: "Travel & Geography",
    keywords: ["itinerary", "culture", "city", "mountain", "beach", "transport", "budget"],
    color: "#2dd4bf",
    questions: [
      "What's a good 5-day itinerary for Kyoto in autumn?",
      "How do I pack light for a two-week Europe trip?",
      "What's the best way to get from Lisbon to Porto?",
      "How do I avoid tourist traps when visiting Rome?",
      "What should I know before hiking in Patagonia?",
      "How do I handle altitude sickness in Cusco?",
      "What's the most efficient way to see Iceland's ring road?",
      "How do I find authentic local food while traveling?",
      "What's the etiquette for tipping in Japan?",
      "How do I plan a budget trip to Southeast Asia?",
      "What are the must-see sites in Istanbul in 3 days?",
    ],
    answers: [
      "Day 1: eastern temples (Kiyomizu, Gion) at dusk. Day 2: Arashiyama bamboo and monkeys. Day 3: Fushimi Inari at sunrise, Nishiki market. Day 4: day trip to Nara. Day 5: north temples and Philosopher's Path. November momiji are peak — book ryokan early.",
      "One carry-on: 5 tops, 2 bottoms, 1 layer, 7 underwear, 3 socks — all in a coordinating palette. Roll clothes, use packing cubes, wear bulkiest items on the plane. Hand-wash synthetics that dry overnight. You can buy anything you forget.",
      "The train is best: ~3 hours on the Alfa Pendular from Lisboa Santa Apolónia, comfortable and scenic along the coast. Buses are cheaper but slower. Driving gives flexibility but parking in Porto is tight. Book train tickets in advance for discounts.",
      "Eat where there's no English menu and no one inviting you in. Wander two streets from major sites. Ask at your hotel where they eat. Avoid restaurants with photo menus near the Colosseum. Trastevere and Testaccio have real Roman cooking.",
      "Wind and rain change fast — pack layers and a shell, not a heavy coat. Book refugios months ahead. The W trek needs reservations; the O circuit even earlier. Bring cash for refugios. Tell someone your route. November to March is peak season.",
      "Acetazolamide helps but descend if symptoms worsen. Arrive a day early, rest, hydrate, avoid alcohol and heavy meals. Coca tea is a mild local remedy. Go slow on stairs. Most acclimatize in 2-3 days. Fly to Cusco, don't bus from sea level.",
      "Drive it in 7-10 days clockwise from Reykjavík. Don't try it in 4 — you'll only see the windshield. Highlights: Seljalandsfoss, Vík, Jökulsárlón glacier lagoon, Mývatn, Akureyri. Check road.is daily — F-roads need a 4x4 and close in winter.",
      "Avoid restaurants on main squares and near attractions. Look for places where locals queue or where the menu is handwritten in one language. Visit morning markets. Ask 'where do you eat?' not 'where should I eat?' Follow office workers at lunch.",
      "Tipping is not expected and can even confuse or offend — service is included. No tip at restaurants, taxis, or hotels. A small gratuity at a high-end ryokan might be appreciated, but cash in an envelope, never handed over. Just say 'gochisousama.'",
      "Fly into Bangkok, out of Hanoi or Singapore. Daily budget $30-50: hostels $8-15, street food $2-5, buses cheap. Vietnam by train, Thailand by bus, Cambodia by shared taxi. Get e-visas in advance. Shoulder seasons (Nov-Feb) are cooler and drier.",
      "Day 1: Sultanahmet (Hagia Sophia, Blue Mosque, Basilica Cistern). Day 2: Topkapı Palace, Grand Bazaar, ferry across the Bosphorus at sunset. Day 3: Spice Market, Galata Tower, walk down İstiklal, dinner in Karaköy. Get a museum pass to skip lines.",
    ],
  },
  {
    label: "Health & Fitness",
    keywords: ["workout", "nutrition", "muscle", "cardio", "recovery", "sleep", "diet"],
    color: "#4ade80",
    questions: [
      "How do I build muscle as a beginner without a gym?",
      "What's the difference between hypertrophy and strength training?",
      "How much protein do I actually need to gain muscle?",
      "Why am I not losing weight even in a calorie deficit?",
      "How do I improve my sleep quality naturally?",
      "What's the best cardio for fat loss without losing muscle?",
      "How often should I rest between workouts?",
      "What causes delayed onset muscle soreness (DOMS)?",
      "How do I fix anterior pelvic tilt from sitting all day?",
      "Is fasted cardio better for fat loss?",
      "How do I structure a push-pull-legs split?",
    ],
    answers: [
      "Bodyweight progressions work: push-ups (incline→decline→one-arm), pull-ups (negatives→full), pistol squats, bridges, hollow holds. 3 sets near failure, 3x/week, progressive overload by adding reps or harder variations. Eat in a slight surplus with enough protein.",
      "Hypertrophy grows muscle size via moderate weights, 8-15 reps, shorter rest. Strength training increases force production via heavy weights, 3-6 reps, long rest. They overlap, but periodizing each emphasizes one adaptation. Bodybuilders hypertrophy; powerlifters strength.",
      "About 1.6-2.2 g per kg of bodyweight daily. More isn't markedly better beyond ~2.2. Spread it across 3-4 meals of 20-40g for muscle protein synthesis. Whole foods first; powder is convenient, not magic. Total calories must also support growth.",
      "You're likely underestimating intake (tracking errors, oils, snacks), overestimating burn, or retaining water from stress, sodium, or hormones. Metabolic adaptation slows things over time. Recheck logging for two weeks strictly, then reassess. Weight fluctuates daily; track the trend.",
      "Keep the bedroom cool, dark, and quiet. Fixed wake time even on weekends. No screens an hour before or use blue-light filters. Avoid caffeine after noon and alcohol. Sunlight in the morning sets your clock. A wind-down routine signals the body to sleep.",
      "Low-intensity steady-state (LISS) — walking, cycling — burns fat with minimal muscle loss and quick recovery. HIIT is time-efficient but harder to recover from alongside lifting. Keep cardio and lifting sessions apart, and don't exceed what your recovery allows.",
      "Beginners recover 48 hours per muscle group, so 3 full-body sessions/week works. Intermediates split by muscle group and can train 4-6 days. Listen to your body — persistent soreness, performance drops, or poor sleep signal under-recovery. Deload every 4-8 weeks.",
      "Micro-tears from unaccustomed or eccentric loading trigger inflammation. The soreness peaks 24-72 hours post-exercise. It's not a measure of growth — you can progress without it. Gradual loading reduces it. Movement and light activity help it pass faster.",
      "Strengthen glutes and hamstrings (bridges, RDLs), stretch tight hip flexors and quads, and fix your sitting posture (feet flat, neutral spine). It's often a flexibility-strength imbalance, not a structural problem. Consistent daily mobility work over weeks shows results.",
      "Not meaningfully. Total calorie balance drives fat loss, not timing. Fasted cardio may burn slightly more fat during the session but the body compensates later. If you feel better fasted and perform fine, do it; if it hurts your training, eat first. Adherence matters most.",
      "Push (chest, shoulders, triceps) Monday, Pull (back, biceps) Tuesday, Legs Wednesday, rest, repeat. 6 days on, 1 off, or 3 on 1 off twice. 15-20 sets per muscle per week. Each session 5-7 exercises. It lets each muscle recover while you train others.",
    ],
  },
  {
    label: "Business & Startups",
    keywords: ["startup", "market", "revenue", "investor", "product", "customer", "growth"],
    color: "#fbbf24",
    questions: [
      "How do I validate a startup idea before building anything?",
      "What's the difference between pre-seed and seed funding?",
      "How do I find my first 10 customers?",
      "What metrics matter most for a SaaS business?",
      "How do I price a new product with no competitors?",
      "What's a cap table and why does it matter?",
      "How do I approach investors for the first time?",
      "What's product-market fit and how do I know I have it?",
      "How do I handle a co-founder disagreement about direction?",
      "What's the best go-to-market for a B2B tool?",
      "How do I calculate customer lifetime value?",
    ],
    answers: [
      "Talk to 20-30 potential customers about their problem, not your solution. Ask about the last time they faced it, what they did, what they paid for. If they don't mention the problem unprompted, it may not be urgent. A landing page with a waitlist tests demand cheaply.",
      "Pre-seed (friends, angels, accelerators) funds proving the problem and early prototype — often $250k-$1M on an idea/team. Seed (VCs) funds initial traction and product — $1-3M on early signal. Pre-seed is about belief; seed is about evidence.",
      "Find them where they already gather — communities, forums, LinkedIn, events. Reach out personally with a specific question, not a pitch. Offer to solve their problem manually first. The first 10 are interviews and hand-holding, not a funnel. Referrals follow.",
      "MRR and its growth rate, churn (logo and revenue), CAC, LTV, and the LTV:CAC ratio. Net revenue retention shows expansion. Burn rate and runway tell you how long you have. Lead indicators (signups, activation) feed lag indicators (revenue). Track a few, deeply.",
      "Value-based pricing: estimate the customer's savings or gains from using it, price as a fraction of that value. Test three price points and see where resistance appears. Anchor high — it's easier to discount than raise. Price signals positioning as much as it captures value.",
      "A cap table lists who owns what — founders, investors, option pool — and dilution over rounds. It determines control and payout at exit. Messy caps (untracked grants, side letters) scare investors. Keep it clean from day one with a lawyer and software.",
      "Get warm intros through founders they've backed. Have a clear narrative: problem, insight, solution, traction, market, team, ask. Send a short deck, not a business plan. Meet many; fit matters as much as money. Don't optimize on valuation alone — speed and terms count.",
      "Product-market fit is when customers pull the product out of your hands — retention is sticky, word-of-mouth grows, you can't keep up with demand. You feel it: usage outpaces your ability to serve. Survey: how disappointed would users be if it disappeared? 40%+ 'very' is a signal.",
      "Revisit the original goals and data. Separate principles from preferences. Use a decision framework: who has the stronger conviction and domain? Try time-boxed experiments. If truly stuck, an external advisor or, worst case, a clean buyout beats a slow split. Document everything.",
      "For B2B, founder-led sales first — you learn the objections and refine the pitch. Identify the ideal customer profile narrowly. Reach them via outbound (personalized email/LinkedIn) and content. Land a few lighthouse accounts, then build a repeatable motion and hire sales.",
      "LTV = (average revenue per user × gross margin) ÷ churn rate. For subscription: ARPU × gross margin × (1/churn). Segment by cohort — some customers are worth 10x others. If LTV < 3× CAC, you're burning money to grow. Factor in expansion revenue.",
    ],
  },
  {
    label: "Education & Learning",
    keywords: ["study", "memory", "learning", "language", "practice", "curriculum", "skill"],
    color: "#a3e635",
    questions: [
      "How do I use spaced repetition to memorize faster?",
      "What's the best way to learn a new language as an adult?",
      "How do I stay focused while studying for long hours?",
      "What's active recall and why is it effective?",
      "How do I learn math when I've always struggled with it?",
      "What's the Feynman technique for learning?",
      "How do I build a consistent study habit?",
      "What's the difference between deep and shallow processing?",
      "How do I take effective notes from a textbook?",
      "How can I improve my reading comprehension?",
      "What's interleaved practice and does it work?",
    ],
    answers: [
      "Review material at increasing intervals — 1 day, 3 days, a week, two weeks — right before you'd forget it. Use Anki or Mochi. The effort of retrieving strengthens memory; easy re-reading doesn't. Spaced repetition exploits the spacing effect for long-term retention.",
      "Get comprehensible input slightly above your level daily — podcasts, graded readers, shows with subtitles. Speak from day one, even badly. Learn the 1000 most common words first. A tutor for conversation accelerates output. Consistency beats intensity — 20 min/day for a year.",
      "Work in 25-50 min blocks with short breaks (Pomodoro). Remove phone and notifications. Define one task per block. Use ambient sound or instrumental music. Take a real walk between blocks. Hydrate and snack. Track streaks. Your brain can't focus 8 hours straight.",
      "Active recall is retrieving information from memory — flashcards, self-quizzing, blank-page summaries — rather than re-reading. Forcing retrieval strengthens the neural pathways that produce the memory. It feels harder than re-reading, and that difficulty is exactly why it works.",
      "Start from where you're solid and rebuild forward. Find the gap — often it's a foundational concept from years ago. Use multiple sources; one explanation will click. Do problems daily, even easy ones. Seek intuition before procedures. Mistakes are data. Growth mindset matters.",
      "Explain the concept in plain language as if teaching a beginner. Where you stumble or use jargon, that's a gap — go back to the source. Simplify with an analogy. The act of teaching reveals what you actually understand versus what you've memorized.",
      "Anchor it to an existing routine (after coffee, before bed). Start tiny — even 10 minutes — to build the streak. Same time, same place. Track it visibly. Remove friction (books ready, tab open). Forgive missed days; never miss two in a row.",
      "Deep processing engages meaning — connecting to prior knowledge, asking why, forming images. Shallow processing is surface — font, sound, rote repetition. Deep processing encodes richer memories. Ask 'what does this mean?' not 'what does it say?' Meaning makes it stick.",
      "Preview headings and summary first. Read a section, then close the book and write what you remember in your own words (active recall). Add questions in the margin for later self-testing. Summarize the chapter in a concept map. Re-read only what you couldn't recall.",
      "Preview, question, read, recite, review (SQ3R). Before reading, ask what you want to learn. Slow down on dense passages. Pause to summarize each section. Look up terms. Connect to what you know. Annotate. Discussing or teaching the material deepens comprehension.",
      "Interleaving mixes related topics in one session (e.g., different math problem types) instead of blocking one type at a time. It feels harder and slower but improves discrimination — you learn when to apply which method. It works for motor and cognitive skills alike.",
    ],
  },
  {
    label: "History & Culture",
    keywords: ["ancient", "empire", "war", "revolution", "civilization", "artifact", "dynasty"],
    color: "#e879f9",
    questions: [
      "What caused the fall of the Western Roman Empire?",
      "How did the printing press change European society?",
      "What was the Silk Road's cultural impact beyond trade?",
      "Why did the Industrial Revolution start in Britain?",
      "What led to the French Revolution?",
      "How did the Mongol Empire govern such a vast territory?",
      "What was the Columbian Exchange and its consequences?",
      "Why did the Ottoman Empire decline?",
      "How did the Renaissance change art and thought?",
      "What caused the Bronze Age Collapse?",
      "How did colonialism shape modern borders in Africa?",
    ],
    answers: [
      "No single cause: chronic civil wars weakened the army and administration; economic strain from inflation and tax evasion; barbarian pressure on overstretched frontiers; the capital moved east, leaving Rome exposed; plagues depopulated regions. It was a slow transformation, not a sudden fall.",
      "It democratized knowledge — books became cheap, literacy spread, ideas moved faster. It fueled the Reformation (Luther's theses went viral), the Scientific Revolution (reproducible findings), and nationalism (standardized languages). It broke the Church's monopoly on interpretation.",
      "It carried religions (Buddhism into China, Islam along its routes), technologies (paper, gunpowder westward), diseases, foods, and artistic styles. Cities like Samarkand became cosmopolitan hubs. It wove Eurasia into a connected system centuries before globalization.",
      "Britain had coal and capital, a stable property-rights system, an agricultural surplus from enclosures, a large wage labor pool (making labor-saving machines worthwhile), and a culture of practical invention. Its empire provided markets and raw materials. Geography plus institutions.",
      "A fiscal crisis from wars and debt, an unfair tax system (clergy and nobility exempt), Enlightenment ideas of equality, food shortages from bad harvests, and a rigid social order (the three estates). The Estates-General's deadlock in 1789 ignited long-smoldering grievances.",
      "Religious tolerance, meritocratic administration, the Yam postal system for communication, local autonomy in exchange for tribute and troops, and brutal deterrence against resistance. They moved skilled artisans across the empire and protected merchants. Pragmatism over ideology.",
      "The exchange of plants, animals, diseases, people, and ideas between hemispheres after 1492. Europeans brought horses, wheat, and smallpox (which devastated Indigenous populations by up to 90%). The Americas sent maize, potatoes, and tomatoes that transformed Old World diets and populations.",
      "Military stagnation against European powers, a sclerotic bureaucracy, fiscal crisis, nationalist revolts among subject peoples, and conservative resistance to reform. The Tanzimat reforms came too late. World War I delivered the final blow; the empire was partitioned by the victors.",
      "It revived classical learning and humanism — focus on human potential and secular inquiry. Artists developed perspective, anatomy, and realism (Leonardo, Michelangelo). Patronage from merchants and the Church drove innovation. It shifted authority from the Church toward individual reason and observation.",
      "A perfect storm around 1200 BCE: earthquakes, drought, famines, invasions by 'Sea Peoples,' internal revolts, and the breakdown of trade networks toppled Mycenaean Greece, Hittite Anatolia, and parts of Egypt. Writing systems vanished in some regions. Recovery took centuries.",
      "At the 1884 Berlin Conference, European powers drew borders with little regard for ethnic, linguistic, or political realities, often using straight lines. This split communities and grouped rivals together, seeding conflicts that persist post-independence. Borders were colonial, not organic.",
    ],
  },
  {
    label: "Mathematics",
    keywords: ["calculus", "proof", "algebra", "geometry", "statistics", "theorem", "function"],
    color: "#c084fc",
    questions: [
      "What's the intuitive meaning of a derivative?",
      "How do I prove something by mathematical induction?",
      "What's the difference between correlation and causation?",
      "How do logarithms work and why are they useful?",
      "What is a proof by contradiction?",
      "How do I understand eigenvalues intuitively?",
      "What's the central limit theorem in plain terms?",
      "How do Bayes' theorem and conditional probability work?",
      "What does it mean for a function to be continuous?",
      "How do I solve a system of linear equations?",
      "What's the meaning of the integral in calculus?",
    ],
    answers: [
      "The derivative is the instantaneous rate of change — how fast one quantity changes as another changes, at a single point. Geometrically, it's the slope of the tangent line. If position is the function, the derivative is velocity; the derivative of velocity is acceleration.",
      "Prove the base case (n=1). Assume the statement holds for some k (inductive hypothesis). Show it then holds for k+1. If both hold, by the principle of induction it holds for all natural numbers. It's a domino chain: tip the first, and each topples the next.",
      "Correlation means two variables move together; causation means one causes the other. Ice cream sales and drownings correlate (both rise in summer) but neither causes the other — heat does. Establishing causation needs controlled experiments or causal inference methods, not just statistics.",
      "A logarithm answers 'to what power must I raise the base to get this number?' log₂(8)=3 because 2³=8. They turn multiplication into addition (log of product = sum of logs), which is why slide rules worked and why they simplify exponential growth and orders of magnitude.",
      "Assume the opposite of what you want to prove. Show this leads to a contradiction. Therefore the assumption was false, so the original statement must be true. Example: √2 is irrational — assume it's rational, derive that a fraction isn't fully reduced, contradiction.",
      "An eigenvector of a transformation is a direction that doesn't change under the transformation — it only stretches or shrinks. The eigenvalue is that stretch factor. Think of a stretched sheet: most points move sideways, but points along the stretch axis just move along that axis.",
      "If you take many sufficiently large samples from any population (regardless of its shape) and average them, the sample means form a normal (bell-curve) distribution centered on the true mean. This is why the normal distribution appears everywhere and underpins confidence intervals.",
      "Bayes updates a prior belief with new evidence: P(A|B) = P(B|A)·P(A)/P(B). It's how likely A is given B, factoring how likely B was given A and how likely A was beforehand. It formalizes revising beliefs with data — central to diagnosis, spam filtering, and inference.",
      "A function is continuous if you can draw its graph without lifting your pen — no jumps, breaks, or holes. Formally, the limit as x approaches a equals f(a). Small input changes produce small output changes. Continuity is weaker than differentiability (a function can be continuous but not smooth).",
      "Use substitution (solve one equation for a variable, substitute into others), elimination (add multiples of equations to cancel variables), or matrices (Gaussian elimination / row reduction to reduced echelon form). For large systems, matrix factorization (LU) is efficient. The solution is where the equations intersect.",
      "The integral measures accumulated quantity — the area under a curve. If velocity is the function, the integral over a time interval is the distance traveled. It's the reverse of the derivative (the fundamental theorem of calculus). Definite integrals give a number; indefinite give a family of functions.",
    ],
  },
  {
    label: "Music & Audio",
    keywords: ["chord", "melody", "mixing", "frequency", "rhythm", "synth", "compression"],
    color: "#facc15",
    questions: [
      "How do I mix a vocal so it sits on top of the beat?",
      "What's the difference between major and minor keys?",
      "How do I use compression on a drum bus?",
      "What's sidechain compression and why is it everywhere?",
      "How do I write a melody that's memorable?",
      "What's the circle of fifths and how do I use it?",
      "How do I EQ a muddy low end in a mix?",
      "What's the difference between reverb and delay?",
      "How do I master a track for streaming loudness?",
      "What makes a chord progression sound good?",
      "How do I layer synths for a bigger sound?",
    ],
    answers: [
      "Carve space: cut competing frequencies (200-500 Hz) from instruments where the vocal lives (1-4 kHz). Compress the vocal consistently. Add subtle saturation for presence. Use a touch of reverb but keep it short. Automate level so every word is audible. Reference against pro mixes.",
      "Major keys sound bright, happy, resolved; minor keys sound dark, sad, tense. The difference is the third — major has a major third (4 semitones), minor a minor third (3 semitones). The same set of intervals, shifted, creates the emotional color we associate with each.",
      "Glue the bus: moderate ratio (2-4:1), slow attack (10-30 ms) to let transients through, fast-ish release to pump with the tempo, threshold for 2-4 dB of gain reduction. Parallel compression adds body without squashing punch. EQ before compressing if you need tone shaping.",
      "Sidechain compression ducks one signal based on another's level — most famously, the bass ducks when the kick hits, creating that pumping dance groove. It creates rhythmic space and energy. Set the kick as the sidechain source on the bass compressor with a fast release for the pump.",
      "Repetition with variation: a motif that returns altered sticks. Aim for a singable contour — stepwise motion with occasional leaps. Rhythm matters as much as pitch; syncopation creates interest. End phrases on stable tones. Sing it back — if you can't, neither will the listener.",
      "The circle arranges keys by fifths clockwise (C-G-D-A...) and fourths counterclockwise. Adjacent keys share most notes — easy modulation. It shows key signatures (sharps accumulate clockwise, flats counterclockwise) and the relative minor on the inner circle. It's a map of harmonic relationships.",
      "High-pass everything that doesn't need bass (vocals, guitars, snares) above 80-120 Hz. Check for buildup around 200-300 Hz — cut a couple dB. Ensure the kick and bass don't fight: carve a pocket for the kick's fundamental (60-80 Hz) in the bass, or vice versa. Mono the low end.",
      "Reverb simulates a space — many reflections decaying together, creating ambience and depth. Delay is discrete repeats at set intervals, more rhythmic and controlled. Reverb blends; delay defines. Use both: short reverb for room, longer delay throws for echoes. Too much of either mushes a mix.",
      "Target -14 LUFS integrated (Spotify's reference) with true peaks below -1 dBTP for streaming. Louder masters (-8 to -10) get turned down and may distort. Use a limiter as the last insert, push gain until the ceiling is reached without audible pumping. Compare loudness-matched references.",
      "Voice leading — smooth movement between chords — matters more than the chords themselves. Common progressions (I-V-vi-IV, ii-V-I) work because they balance tension and release and resolve naturally. Diatonic chords share notes, creating cohesion. Surprise chords work best after establishing a key.",
      "Layer complementary timbres: a bright saw on top, a warm triangle beneath, a sub sine for weight. Give each layer its own frequency space with EQ. Slight detuning between layers thickens. Pan them apart. Route to a bus for unified processing. Fewer, well-chosen layers beat many muddy ones.",
    ],
  },
  {
    label: "Art & Design",
    keywords: ["color", "layout", "typography", "composition", "contrast", "grid", "ui"],
    color: "#38bdf8",
    questions: [
      "How do I choose a color palette that works together?",
      "What's the rule of thirds in composition?",
      "How do I pair fonts without them clashing?",
      "What's visual hierarchy and how do I create it?",
      "How do I use white space effectively in a layout?",
      "What's the difference between RGB and CMYK?",
      "How do I make a design feel premium and not cheap?",
      "What's a grid system and why use one?",
      "How do I create depth in a flat illustration?",
      "What makes good icon design?",
      "How do I use contrast beyond just color?",
    ],
    answers: [
      "Pick a dominant color (60%), a secondary (30%), and an accent (10%). Use a tool to derive harmonies — analogous for calm, complementary for energy, triadic for balance. Limit saturation variety. Test on real content, not a blank canvas. Accessibility: check contrast ratios for text.",
      "Divide the frame into a 3×3 grid. Place subjects at intersections or along the lines rather than dead center — it creates dynamic tension and guides the eye. Horizons sit on the upper or lower third, rarely the middle. It's a guideline; break it intentionally for symmetry or tension.",
      "Pair a serif with a sans-serif for contrast, or two sans-serifs of different weights. Match x-heights so they align on a baseline. One for headings, one for body. Avoid two fonts with strong personality — they'll fight. Limit to two families; use weight and size for hierarchy.",
      "Visual hierarchy guides the eye from most to least important. Create it with size (bigger = more important), color (saturated draws attention), contrast, weight, position, and spacing. The user should know where to look first, second, third — within a second. Squint at it; what stands out?",
      "White space isn't empty — it's a design element. It groups (related items close), separates (unrelated items apart), and gives the eye rest. Generous margins feel premium; tight spacing feels dense. Don't fill every pixel. Let content breathe. Hierarchy needs space to read.",
      "RGB is additive (light) for screens — red, green, blue combine to white. CMYK is subtractive (ink) for print — cyan, magenta, yellow, key (black) combine to dark. Colors out of gamut shift between them. Design in the destination space; convert carefully for print with a profile.",
      "Restraint: fewer fonts, fewer colors, more white space. Consistency: a strict grid and type scale. Detail: precise alignment, fine borders, subtle shadows. Quality assets: high-res images, custom icons. Generous margins. Cheap design crowds and shouts; premium design whispers and breathes.",
      "A grid is a structure of columns, rows, and gutters that aligns content. It creates rhythm, consistency, and efficiency — elements snap to a system. Use a 12-column grid for flexibility. Break the grid intentionally for emphasis. Grids scale from print to responsive web. They make layouts coherent.",
      "Overlap shapes to imply layering. Vary scale — distant elements smaller and lighter. Use atmospheric perspective: desaturate and lighten 'far' colors. Add subtle gradients and shadows. A consistent light direction grounds everything. Texture on near objects, smooth on far. Depth is suggested, not rendered.",
      "Simplicity: reduce to essential forms. Consistency: uniform stroke weight, corner radius, and scale across the set. Clarity: recognizable at small sizes. Alignment to a pixel grid for crisp rendering. A unified visual language. Test at 16px — if it's unclear, simplify further.",
      "Contrast in size (big vs small), weight (bold vs light), shape (round vs angular), texture (smooth vs rough), spacing (dense vs airy), and position (aligned vs offset). Color is one axis. Strong contrast creates focus; weak contrast creates unity. Vary multiple axes for richer compositions.",
    ],
  },
  {
    label: "Gaming & Game Dev",
    keywords: ["game", "engine", "render", "physics", "level", "shader", "gameplay"],
    color: "#6ee7b7",
    questions: [
      "How do I optimize a game that drops frames in busy scenes?",
      "What's the difference between a coroutine and a thread in Unity?",
      "How do I design a boss fight that feels fair?",
      "What's the component pattern in game architecture?",
      "How do I write a shader that makes water look realistic?",
      "What makes good level design pacing?",
      "How do I balance an RPG's combat system?",
      "What's the difference between forward and deferred rendering?",
      "How do I implement a save system that's robust?",
      "What's a state machine and how do I use it for AI?",
      "How do I make a platformer feel responsive?",
    ],
    answers: [
      "Profile first — don't guess. Common culprits: draw calls (batch, instancing, atlas), overdraw (cull, LOD, occlusion), shader cost (simplify, bake), physics (reduce pairs, fixed timestep), GC spikes (pool objects, avoid per-frame allocations). CPU or GPU bound? Target the actual bottleneck.",
      "Coroutines run on the main thread, yielding between frames — great for sequencing over time without blocking. Threads run in parallel — for heavy compute, but you can't touch Unity APIs from them. Use coroutines for gameplay timing, threads for compute, and Jobs/Burst for data-parallel work.",
      "Telegraph attacks clearly — wind-ups, audio cues, color flashes. Give recovery windows to punish. Avoid one-shot kills unless signaled. Phases escalate without feeling cheap. Patterns are learnable. The player should feel they failed by mistake, not by design. Test with players who rage.",
      "Entities are IDs; components are plain data; systems process all entities with matching components. This decouples behavior — a 'Health' component is reused across players, enemies, destructibles. It's cache-friendly and scales. Unity's DOTS, Unreal's Mass, and custom engines use variants of it.",
      "Layer effects: a depth gradient (darker far), Fresnel for edge highlights, normal-mapped ripples for surface detail, refraction for the underwater distortion, specular sun glints, and foam where it meets objects. Gerstner waves displace vertices for motion. Combine in a custom shader; cheap fake beats expensive sim.",
      "Vary intensity — quiet exploration after a combat spike. Introduce mechanics simply, then combine them. Build tension toward a set piece, then release. Reward curiosity. Use landmarks for orientation. Pacing is rhythm; sustained high intensity fatigues, sustained low intensity bores. Alternate.",
      "Define the core loop and a target time-to-kill. Spreadsheet everything: damage, health, armor, cooldowns. Model expected DPS vs enemy HP. Playtest and tune by feel. Avoid false choices — every option should be viable in some situation. Iterate; numbers on paper lie until played.",
      "Forward rendering draws each object with all lights — cheap with few lights, expensive with many. Deferred renders geometry to G-buffers once, then lights in screen space — handles many lights efficiently, but struggles with transparency and MSAA. Choose by your scene's light count and transparency needs.",
      "Version your save format. Serialize deterministic data (state, inventory, position) — never references or runtime objects. Write atomically (temp file + rename) to avoid corruption. Validate on load and migrate old versions. Store in a known location per platform. Test load-after-patch.",
      "A finite state machine: an entity is in one state (patrol, chase, attack, flee) with defined transitions triggered by conditions (sees player, low health). It's readable and debuggable — draw the graph. For richer behavior, add hierarchical or behavior trees, but start with an FSM.",
      "Input buffer: store the last jump press for ~100ms so a press slightly early still registers. Coyote time: allow jumping for ~100ms after leaving a ledge. Variable jump height (hold for higher). Tight acceleration/deceleration. Snap out of attacks into jumps. These 'forgiveness' windows feel responsive.",
    ],
  },
  {
    label: "Personal Productivity",
    keywords: ["habit", "focus", "time", "priority", "task", "goal", "workflow"],
    color: "#fda4af",
    questions: [
      "How do I stop procrastinating on important tasks?",
      "What's the best task management system for a busy person?",
      "How do I build a habit that actually sticks?",
      "How do I deal with constant interruptions at work?",
      "What's time blocking and does it work?",
      "How do I prioritize when everything feels urgent?",
      "How do I maintain focus when working from home?",
      "What's the two-minute rule?",
      "How do I review my week effectively?",
      "How do I avoid burnout while being productive?",
      "What's deep work and how do I get more of it?",
    ],
    answers: [
      "Reduce friction to start — commit to just two minutes. Break big tasks into tiny next actions. Remove phone and tabs. Identify the emotion behind avoidance (fear, boredom, overwhelm) and address it. The hardest part is starting; momentum follows. Lower the bar to begin.",
      "One you'll actually use. A simple list with priorities works for many. GTD for capturing everything. Time-blocking for execution. The system matters less than the habit of using it daily. Avoid tool-hopping — the friction of switching kills consistency. Pick one, stick for 90 days.",
      "Start tiny — one push-up, one page. Anchor it to an existing routine (after coffee). Track it visibly. Don't break the chain; if you miss, never miss twice. Reward yourself. Identity matters: 'I'm a runner' beats 'I'm trying to run.' Stack habits onto established ones.",
      "Batch communications — check email and chat at set times, not constantly. Set status to focus mode. Use 'office hours' for availability. Negotiate expectations with your team. Protect a daily deep-work block. Most 'urgent' interruptions aren't. Train people to respect focused time.",
      "Time blocking assigns specific hours to specific tasks — 9-11 deep work, 11-12 email, etc. It forces prioritization and prevents the day filling with reactive work. It works because context-switching is costly. Leave buffers for the unexpected. Review and adjust weekly; don't over-schedule.",
      "Use the Eisenhower matrix: urgent + important (do now), important not urgent (schedule — this is where real progress lives), urgent not important (delegate), neither (drop). Most 'urgent' things are urgent to someone else. Protect the important-not-urgent quadrant ruthlessly.",
      "A dedicated workspace, a start ritual, fixed hours, and a real lunch break. Dress for work. Use noise-canceling or ambient sound. Communicate your schedule to housemates. End the day with a shutdown ritual. Separate work from life physically and temporally — don't let it blur.",
      "If a task takes less than two minutes, do it now rather than tracking it. It clears small items that clutter your mind and list, freeing attention for bigger work. Don't apply it to everything — some two-minute tasks are interruptions; batch those instead. Use judgment.",
      "Block 20-30 minutes weekly. Review what you did, what worked, what didn't. Did you spend time on what matters? What will you prioritize next week? Update your task list. Note wins and lessons. It closes loops, builds self-awareness, and sets intentional direction for the week ahead.",
      "Schedule rest like work — it's not the absence of productivity, it's its foundation. Sleep, exercise, and downtime aren't rewards for finishing; they're prerequisites. Watch for cynicism, exhaustion, and reduced efficacy as warning signs. Sustainable pace beats heroic sprints. Say no to protect capacity.",
      "Deep work is focused, distraction-free work on a cognitively demanding task — the kind that creates value and skill. To get more: schedule protected blocks, eliminate distractions, train your focus (it's a muscle), and quit shallow work like endless email. It's rare and increasingly valuable.",
    ],
  },
  {
    label: "Psychology & Relationships",
    keywords: ["emotion", "communication", "conflict", "attachment", "boundaries", "empathy", "anxiety"],
    color: "#f87171",
    questions: [
      "How do I communicate better when I'm upset?",
      "What's the difference between empathy and sympathy?",
      "How do I set a boundary without feeling guilty?",
      "Why do I overthink social interactions after they happen?",
      "How do I support a friend going through a hard time?",
      "What causes attachment styles in adults?",
      "How do I handle conflict with a partner productively?",
      "Why do I procrastinate and how is it emotional?",
      "How do I manage anxiety before a big event?",
      "What's gaslighting and how do I recognize it?",
      "How do I rebuild trust after it's broken?",
    ],
    answers: [
      "Name the emotion first ('I'm feeling hurt because...') before speaking. Use 'I' statements, not accusations. Slow down — pause before reacting. State the need, not just the complaint. Ask about the other's perspective. Regulate before you communicate; you can't be heard from a flooded state.",
      "Sympathy is feeling for someone from a distance — 'that's sad.' Empathy is feeling with them — stepping into their experience without fixing it. Empathy says 'I've been there' or 'that sounds really hard' and stays present. Sympathy often distances; empathy connects. Both have their place.",
      "A boundary isn't a punishment; it's self-respect stated clearly. 'I need X to feel okay.' Expect discomfort at first — guilt means you're changing a pattern. You're responsible for the boundary, not their reaction. Kind and firm can coexist. Guilt fades as the boundary becomes normal.",
      "It's often social anxiety — the brain rehearsing what went wrong to 'prevent' future harm. It's driven by a fear of judgment. Notice it without engaging: 'I'm overthinking again.' Challenge the thoughts — would you judge a friend this harshly? Exposure and self-compassion reduce it over time.",
      "Show up and stay present. Don't try to fix or silver-line it. Say 'I'm here.' Follow their lead — some want to talk, some want distraction. Offer specific help ('I'm bringing dinner Tuesday') rather than 'let me know.' Check in later, when others have moved on. Consistency matters most.",
      "Early relationships with caregivers shape a working model of closeness: secure (responsive caregivers), anxious (inconsistent), avoidant (rejecting), disorganized (frightening). These patterns persist but aren't fixed — secure relationships, therapy, and awareness can shift them over time.",
      "Start soft — a harsh opening escalates. Stick to one issue, not a list. Use 'I feel' not 'you always.' Take a 20-minute break if flooded, then return. Repair attempts (apology, humor, touch) matter more than perfection. Listen to understand, not to rebut. End with a plan, not a winner.",
      "Procrastination is emotional regulation, not laziness — you avoid tasks that trigger anxiety, boredom, or self-doubt. The relief of avoiding is immediate; the cost is delayed. Break tasks tiny to lower the emotional threshold. Forgive past procrastination — guilt fuels more avoidance. Start badly.",
      "Name it: 'this is anxiety, not danger.' Breathe slowly to down-regulate. Prepare what you can; release the rest. Reframe the physical sensation as excitement, not threat. Limit caffeine. Arrive early to settle. The wave peaks and passes — you've survived every one so far.",
      "Gaslighting is manipulating someone to doubt their own perception or memory — 'that never happened,' 'you're too sensitive,' shifting blame. Patterns: denial of things you know happened, isolation, moving goalposts. Trust your memory, document incidents, and talk to others to verify reality.",
      "Acknowledge the harm without defensiveness. The hurt party needs to feel understood before trust can rebuild. Be transparent and consistent over time — trust is rebuilt through small, reliable actions, not grand gestures. Expect setbacks. It takes as long as it takes; you can't rush the other's timeline.",
    ],
  },
  {
    label: "Home & DIY",
    keywords: ["repair", "paint", "tools", "garden", "plumbing", "electrical", "woodwork"],
    color: "#eab308",
    questions: [
      "How do I fix a leaky faucet myself?",
      "What's the right way to paint a room without streaks?",
      "How do I unclog a drain without harsh chemicals?",
      "How do I patch a hole in drywall?",
      "What basic tools should every homeowner own?",
      "How do I start a vegetable garden from scratch?",
      "How do I fix a squeaky floorboard?",
      "What's the difference between a fuse and a breaker?",
      "How do I caulk a bathtub neatly?",
      "How do I sharpen a kitchen knife at home?",
      "How do I hang a heavy shelf on a drywall wall?",
    ],
    answers: [
      "Turn off the water. Most leaks are a worn washer or cartridge. Unscrew the handle, remove the stem, and replace the rubber washer or O-ring (bring the old one to the store to match). Reassemble and test. Compression faucets are simplest; cartridge types vary by brand.",
      "Prep is everything: fill holes, sand, clean, tape edges. Cut in edges with a brush first. Roll in 3-foot W patterns, then spread evenly without overworking. Maintain a wet edge — overlap the previous section before it dries. Two thin coats beat one thick one. Use quality rollers and paint.",
      "Pour baking soda down, then vinegar, let fizz 15 minutes, then flush with boiling water. A plunger or a drain snake (zip-tie with notches works) clears hair. For stubborn clogs, a plumber's snake reaches deep. Avoid chemical drain cleaners — they corrode pipes and are toxic.",
      "For small holes: spackle with a putty knife, let dry, sand smooth, prime, paint. For larger: cut a clean square, insert a backing, tape mesh over seams, apply joint compound in thin layers feathering outward, sand between coats, prime, paint. Take time feathering — it hides the patch.",
      "A 16-oz hammer, screwdrivers (Phillips and flat) or a driver set, adjustable wrench, pliers, tape measure, level, utility knife, stud finder, putty knife, flashlight, and a cordless drill with bits. Add a pipe wrench, plunger, and voltage tester for plumbing and electrical basics.",
      "Pick a sunny spot (6+ hours). Build raised beds for control and drainage. Fill with a mix of topsoil, compost, and aeration. Start with easy wins: tomatoes, lettuce, radishes, herbs. Water consistently. Mulch to retain moisture. Visit daily. Compost for next year. Start small and expand.",
      "Find the joist (the board under the floor) near the squeak. For carpet, use a stud finder. Drive a trim screw through the floorboard into the joist — for hardwood, pre-drill to avoid splitting, countersink, and fill with wood filler. For access from below, screw up through the subfloor into the board.",
      "A fuse melts (sacrifices itself) when current exceeds its rating — you replace it. A breaker trips (mechanical switch) and you reset it. Breakers are reusable, more convenient, and standard in modern homes. Both protect circuits from overcurrent that could overheat wires and start fires.",
      "Remove old caulk completely. Dry the surfaces. Tape both sides of the joint with painter's tape for crisp lines. Cut the tube tip at 45°, squeeze a steady bead, then smooth with a wet finger or tool in one pass. Pull the tape immediately while wet. Don't touch until cured (24 hours).",
      "Use a whetstone (double-sided, coarse/fine). Wet it. Hold the blade at ~20°. Draw the edge across the stone from heel to tip, alternating sides, 5-10 strokes per side on coarse, then fine. A burr forms then refines. Test on paper — it should slice cleanly. Hone with a steel between sharpenings.",
      "Find the studs — drywall alone won't hold weight. Use a stud finder; studs are usually 16 inches apart. Drill pilot holes into the stud and use long enough screws (2.5+ inches). If no stud, use heavy-duty anchors (toggle bolts for the heaviest loads). Level the shelf before final tightening.",
    ],
  },
];

// ---------------------------------------------------------------------------
// Coordinate generation — galaxy disk distribution
// ---------------------------------------------------------------------------
// Distribute cluster centers along a loose 3-armed spiral, flattened on Y
// to evoke a galaxy disk. Each node sits near its cluster center with
// gaussian scatter.
function generateClusterCenters(n: number) {
  const centers: { x: number; y: number; z: number }[] = [];
  const arms = 3;
  for (let i = 0; i < n; i++) {
    const arm = i % arms;
    const armOffset = (arm / arms) * Math.PI * 2;
    // spiral parameter: angle grows with index, radius grows with index
    const t = (i / n) * Math.PI * 3.2; // ~1.6 turns
    const radius = 18 + t * 9; // 18 -> ~47
    const angle = t + armOffset + randRange(-0.25, 0.25);
    const x = Math.cos(angle) * radius + randRange(-4, 4);
    const z = Math.sin(angle) * radius + randRange(-4, 4);
    // flatten on Y (galaxy disk), with some clusters higher/lower
    const y = randRange(-14, 14) + Math.sin(t) * 4;
    centers.push({ x, y, z });
  }
  return centers;
}

function nodePosition(center: { x: number; y: number; z: number }) {
  // gaussian scatter around center, slightly elongated for a nebula look
  const spread = 7.5;
  // ~8% of nodes are outliers placed farther out
  const isOutlier = rand() < 0.08;
  const factor = isOutlier ? randRange(2.2, 3.4) : 1;
  return {
    x: +(center.x + gauss() * spread * factor).toFixed(2),
    y: +(center.y + gauss() * spread * 0.5 * factor).toFixed(2),
    z: +(center.z + gauss() * spread * factor).toFixed(2),
  };
}

// ---------------------------------------------------------------------------
// Timestamp distribution across 2024
// ---------------------------------------------------------------------------
const YEAR_START = Date.UTC(2024, 0, 1);
const YEAR_END = Date.UTC(2025, 0, 1);
const YEAR_SPAN = YEAR_END - YEAR_START;

function randomTimestamp(clusterId: number, indexInCluster: number) {
  // Each cluster has a "peak activity" window, with bursts
  const peak = (clusterId / TOPICS.length) * YEAR_SPAN;
  const offset = gauss() * (YEAR_SPAN / 6) + (indexInCluster % 7) * 86400000 * 3;
  let t = YEAR_START + peak + offset;
  // wrap into range
  while (t < YEAR_START) t += YEAR_SPAN / 3;
  while (t > YEAR_END) t -= YEAR_SPAN / 3;
  // add intra-day randomness
  t += randInt(0, 86400000 - 1);
  return new Date(t).toISOString();
}

// ---------------------------------------------------------------------------
// Build nodes
// ---------------------------------------------------------------------------
interface NodeData {
  id: number;
  x: number;
  y: number;
  z: number;
  clusterId: number;
  title: string;
  snippet: string;
  fullText: string;
  role: "user" | "assistant";
  timestamp: string;
  wordCount: number;
  source: string;
}

const SOURCES = ["chatgpt-export", "claude-export", "generic"];

function titleFromQuestion(q: string) {
  const words = q.replace(/^(how do i|what's|why|how can i|is|are|what did|how does)\s+/i, "").split(/\s+/);
  return words.slice(0, 8).join(" ") + (words.length > 8 ? "…" : "");
}

function buildNodes() {
  const centers = generateClusterCenters(TOPICS.length);
  const nodes: NodeData[] = [];
  let id = 0;

  for (let c = 0; c < TOPICS.length; c++) {
    const topic = TOPICS[c];
    const center = centers[c];
    // ~200 nodes per cluster for ~3600 total
    const count = 190 + randInt(0, 40);
    let qIdx = 0;
    for (let i = 0; i < count; i++) {
      const question = topic.questions[qIdx % topic.questions.length];
      const answer = topic.answers[i % topic.answers.length];
      qIdx++;
      // vary the user prefix slightly for uniqueness
      const prefixes = ["", "Quick question — ", "Hi, ", "I'm wondering: ", "Can you help? ", ""];
      const userText = pick(prefixes) + question;
      const fullText = `User: ${userText}\nAssistant: ${answer}`;
      const pos = nodePosition(center);
      const snippet = fullText.slice(0, 150);
      nodes.push({
        id: id++,
        x: pos.x,
        y: pos.y,
        z: pos.z,
        clusterId: c,
        title: titleFromQuestion(question),
        snippet: snippet.length === 150 ? snippet + "…" : snippet,
        fullText,
        role: "user",
        timestamp: randomTimestamp(c, i),
        wordCount: fullText.split(/\s+/).length,
        source: pick(SOURCES),
      });
    }
  }
  return nodes;
}

// ---------------------------------------------------------------------------
// Assemble & write
// ---------------------------------------------------------------------------
function buildClusters(nodes: NodeData[]) {
  return TOPICS.map((t, i) => {
    const count = nodes.filter((n) => n.clusterId === i).length;
    return {
      id: i,
      label: t.label,
      keywords: t.keywords,
      color: t.color,
      count,
    };
  });
}

function main() {
  const nodes = buildNodes();
  const clusters = buildClusters(nodes);
  const data = {
    metadata: {
      totalNodes: nodes.length,
      totalClusters: clusters.length,
      generatedAt: new Date().toISOString(),
      source: "demo-synthetic",
      dateRange: {
        start: new Date(YEAR_START).toISOString(),
        end: new Date(YEAR_END).toISOString(),
      },
    },
    clusters,
    nodes,
  };

  const outDir = path.join(process.cwd(), "public", "data");
  fs.mkdirSync(outDir, { recursive: true });
  const outPath = path.join(outDir, "cosmos-data.json");
  fs.writeFileSync(outPath, JSON.stringify(data));

  const sizeMB = (fs.statSync(outPath).size / (1024 * 1024)).toFixed(2);
  console.log(`✓ Wrote ${outPath}`);
  console.log(`  Nodes: ${nodes.length}`);
  console.log(`  Clusters: ${clusters.length}`);
  console.log(`  File size: ${sizeMB} MB`);
  console.log(`  Sample node:`, JSON.stringify(nodes[0], null, 2));
}

main();
