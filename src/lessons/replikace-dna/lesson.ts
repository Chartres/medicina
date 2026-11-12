// Replikace DNA — the texts, in the usual terms of the Czech gymnázium syllabus (the request came without
// workbook pages), and the wiring of the fork model (model.ts) to the kit.
//
// Plan: the one thing easier to see in space and time is the replication fork, with the two antiparallel
// templates: the new strand on the upper arm runs towards the fork, the one on the lower arm away from it.
// One track, eight steps (closed helix, unwinding, primers, leading strand, lagging strand, primer
// replacement, ligase, two molecules). Twelve parts: the mother DNA (ends and a base pair as sub-parts),
// topoisomerase, helicase, fork, SSB, primase, primer, polymerase (3′ end, dNTP, pyrophosphate as
// sub-parts), leading strand, lagging strand, Okazaki fragment, ligase. Four layers: old strands, new
// strands, primers, proteins. Numbers: primers, Okazaki fragments, double helices.
import { defineLesson, type Part, type Step } from '../../kit/types.ts'
import { glass, pigments } from '../../kit/pigments.ts'
import { counts, drawFork, state } from './model.ts'
import type { Meta } from '../../kit/types.ts'
import meta from './meta.json' with { type: 'json' }

const T = (name: string, weight: number, tip: string, desc: string, q: string, a: string, etym: string, short?: string): Step => ({ name, short, weight, tip, desc, q, a, etym })
const STEPS: Step[] = [
  T('Dvoušroubovice', .7, 'Jedna celistvá šroubovice se dvěma modrými řetězci, mezi nimi příčky bází a žádný enzym.',
    'Před replikací je DNA jedna dvoušroubovice ze dvou mateřských řetězců. Drží pohromadě vodíkovými můstky mezi komplementárními bázemi: adenin proti thyminu, guanin proti cytosinu. Řetězce běží proti sobě, antiparalelně: kde má jeden konec 5′, má druhý konec 3′. Šroubovice je pravotočivá a na jeden závit připadá asi deset párů bází.',
    'Proč buňka nemůže postavit nový řetězec vedle starého bez rozplétání?',
    'Báze, podle kterých se kopíruje, jsou spárované a schované uvnitř šroubovice. Dokud se řetězce nerozestoupí, nemá se nový nukleotid k čemu přiložit.',
    'Replikace z latinského replicare, složit zpět, zopakovat: re-, znovu, a plicare, skládat. Semikonzervativní: latinsky semi, polovina, a conservare, uchovat. Každá nová molekula si uchová polovinu staré.'),
  T('Rozplétání', 1, 'Zelený kroužek helikázy sedí tam, kde se šroubovice rozestupuje do písmene Y.',
    'Helikáza se naváže v replikačním počátku a začne dvoušroubovici rozplétat: ruší vodíkové můstky a odděluje řetězce od sebe. Vzniká replikační vidlička. Rozpletené řetězce by se rády spojily zpět, proto je obsadí SSB proteiny. Před vidličkou se zbytek šroubovice nadměrně stáčí, topoizomeráza napětí uvolní tím, že řetězec dočasně přeruší a zase spojí.',
    'Co by se stalo se šroubovicí před vidličkou, kdyby topoizomeráza chyběla?',
    'Stáčela by se stále víc, až by helikáza nemohla dál. Fluorochinolonová antibiotika blokují bakteriální topoizomerázu, gyrázu, a tím bakterii zastaví replikaci.',
    'Helikáza z řeckého helix, závit, šroubovice. Koncovka -áza je z názvu diastáza, prvního popsaného enzymu (Payen a Persoz, 1833); jako obecnou příponu pro enzymy ji navrhl Duclaux roku 1899.'),
  T('Primáza a primer', 1, 'Na každém rozpleteném řetězci leží krátký fialový úsek RNA, u něj malá zelená kulička primázy.',
    'DNA polymeráza neumí začít nový řetězec od nuly, umí jen prodlužovat už existující 3′ konec. Začátek proto udělá primáza: podle předlohy sestaví krátký úsek RNA, primer, dlouhý zpravidla kolem deseti nukleotidů. Na jedné předloze stačí jeden primer na samém začátku. Na druhé ho primáza položí blízko vidličky a bude jich potřeba mnoho.',
    'Proč primer dělá primáza z RNA, a ne DNA polymeráza z DNA?',
    'Primáza umí spojit dva volné nukleotidy bez předchozího 3′ konce, DNA polymeráza ne. Cenou je, že RNA se musí později vyměnit za DNA.',
    'Primer z latinského primus, první: je první na řadě. Primáza je enzym, který ho sestaví.', 'Primer'),
  T('Vedoucí řetězec', 1.1, 'Na jedné předloze roste souvislý červený řetězec k vidličce, na jeho špičce sedí zelená polymeráza.',
    'DNA polymeráza přisedne na 3′ konec primeru a přidává nukleotidy podle komplementarity. Nový řetězec roste jen na 3′ konci, tedy ve směru od 5′ ke 3′. Na jedné z předloh míří tento směr k vidličce, polymeráza ji tedy může plynule následovat. Výsledkem je jeden souvislý vedoucí řetězec.',
    'Proč polymeráza přidává nukleotid jen na 3′ konec a nikdy na 5′?',
    'Energii pro novou vazbu nese přicházející nukleotid ve svých třech fosfátech. Volná skupina –OH na 3′ konci řetězce na ně zaútočí, dva fosfáty odpadnou a vazba vznikne. Víc v kartě polymerázy.',
    'Vedoucí, anglicky leading strand: vede, je napřed. Polymeráza z řeckého polys, mnoho, a meros, díl: skládá mnoho dílů v jeden řetězec.', 'Vedoucí'),
  T('Opožďující se řetězec', 1.3, 'Na druhé předloze vznikají krátké červené kousky, každý roste od vidličky pryč a začíná fialovým primerem.',
    'Druhá předloha míří opačně, směr od 5′ ke 3′ na ní vede od vidličky pryč. Polymeráza tu nemůže jet za helikázou, postupuje po kouscích pozpátku. Primáza položí nový primer blízko vidličky a polymeráza od něj syntetizuje směrem pryč, dokud nenarazí na předchozí kousek. Těmto úsekům se říká Okazakiho fragmenty. Celý řetězec se nazývá opožďující se, protože za vidličkou zaostává.',
    'Kolik primerů potřebuje u jedné vidličky vedoucí řetězec a kolik opožďující se?',
    'Vedoucí jeden, opožďující se jeden na každý Okazakiho fragment. U člověka je fragment dlouhý asi 100 až 200 nukleotidů, u bakterií 1000 až 2000.',
    'Reiji a Tsuneko Okazakiovi fragmenty prokázali roku 1968 na bakterii Escherichia coli. Anglicky lagging strand, zaostávající řetězec.', 'Opožďující'),
  T('Výměna primerů', 1, 'Vidlička dojíždí na konec molekuly, fialové primery za ní mizí a nahrazuje je červená DNA.',
    'RNA v hotové molekule DNA zůstat nesmí. Když polymeráza dalšího fragmentu dorazí k primeru, primer se odstraní a mezera se doplní nukleotidy DNA. U bakterií to zvládne DNA polymeráza I, u člověka na tom spolupracuje několik enzymů. Mezi doplněným úsekem a sousedním fragmentem zůstává nespojené místo, zářez v cukr-fosfátové kostře.',
    'Co by se stalo, kdyby primery v DNA zůstaly?',
    'RNA je chemicky méně stálá než DNA, její ribóza má navíc skupinu –OH, která snadno přeruší kostru. Řetězec by se v těch místech lámal a buňka by si do genomu zanesla slabá místa.',
    'Primer z latinského primus, první. Fragment z latinského frangere, lámat: ulomený kousek.'),
  T('Ligáza', 1.1, 'Vidlička už je pryč, zelená spona ligázy objímá nový řetězec v místě zářezu a spojuje kousky.',
    'DNA ligáza zářezy zacelí: vytvoří fosfodiesterovou vazbu mezi 3′ koncem jednoho úseku a 5′ koncem druhého. Z Okazakiho fragmentů tak vznikne jeden souvislý řetězec. Na vedoucím řetězci má ligáza práci jen tam, kde byl vyměněn primer. Vidlička mezitím dojela na konec a helikáza i polymerázy se uvolňují.',
    'Proč ligáza potřebuje energii, když jen spojuje dva konce, které už leží vedle sebe?',
    'Vznik fosfodiesterové vazby energii stojí. Ligáza ji bere z ATP, bakteriální z NAD⁺, a přes aktivovaný 5′ fosfát v zářezu ji vloží do nové vazby.',
    'Ligáza z latinského ligare, vázat, spojovat. Stejný kořen má ligatura i liga.'),
  T('Dvě molekuly', .8, 'Dvě samostatné dvoušroubovice bez enzymů, každá z jednoho modrého starého a jednoho červeného nového řetězce.',
    'Z jedné molekuly jsou dvě a obě nesou stejnou informaci. Každá má jeden mateřský řetězec a jeden nový, proto se replikace nazývá semikonzervativní. Staré řetězce sloužily jako předloha a nikam se neztratily. Polymeráza si navíc práci po sobě kontroluje, po všech opravách zůstane zhruba jedna chyba na miliardu párů bází.',
    'Co by vyšlo, kdyby stará dvoušroubovice zůstala celá a nová byla celá z nových řetězců?',
    'To je konzervativní model. Meselson a Stahl ho roku 1958 vyloučili: bakterie pěstované v těžkém izotopu dusíku přenesli do lehkého a po jednom dělení našli jen DNA střední hustoty, napůl starou a napůl novou.',
    'Semikonzervativní: latinsky semi, polovina, a conservare, uchovat. Dvoušroubovici popsali Watson a Crick roku 1953 a hned dodali, že párování bází napovídá, jak se DNA kopíruje.'),
]

// numbered parts, numbers fixed through the lesson (Comenius: the numeral in the picture is the numeral in the text)
const PARTS: Record<string, Part> = {
  dna: { n: 1, zoom: 2.2, back: 'Zpět na mateřskou DNA', name: 'Mateřská DNA', what: 'Původní dvoušroubovice, předloha pro kopírování. Dva řetězce drží pohromadě vodíkové můstky mezi komplementárními bázemi a běží proti sobě, antiparalelně.', deep: 'Každý řetězec má cukr-fosfátovou kostru s určeným směrem: na 5′ konci končí fosfátem na pátém uhlíku deoxyribózy, na 3′ konci hydroxylovou skupinou na třetím uhlíku. Tahle asymetrie rozhoduje o všem dalším, polymeráza umí prodlužovat jen 3′ konec. Otoč model: šroubovice je pravotočivá, jako B-DNA v buňce, a na jeden závit připadá asi deset párů bází.', subs: ['e5', 'e3', 'bp'] },
  e5: { n: 'a', parent: 'dna', name: '5′ konec', what: 'Konec řetězce, kde je na pátém uhlíku cukru volný fosfát. Každý z mateřských řetězců ho má na opačném konci modelu než ten druhý.', deep: 'Nový řetězec se od svého 5′ konce nikdy neprodlužuje. Proto na konci lineárního chromozomu nemá poslední primer opožďujícího se řetězce kdo nahradit a konce se s každým dělením o kousek zkracují, dokud je nedoplní telomeráza.' },
  e3: { n: 'b', parent: 'dna', name: '3′ konec', what: 'Konec řetězce s volnou hydroxylovou skupinou –OH na třetím uhlíku cukru. Jen sem umí DNA polymeráza připojit další nukleotid.', deep: 'Léky, kterým 3′-OH chybí, řetězec ukončí: acyklovir proti herpetickým virům a zidovudin (AZT) proti HIV se zařadí do rostoucí DNA a dál už nejde pokračovat. Stejný princip používá Sangerovo sekvenování s dideoxynukleotidy.' },
  bp: { n: 'c', parent: 'dna', name: 'Pár bází', what: 'Příčka mezi řetězci: adenin proti thyminu drží dva vodíkové můstky, guanin proti cytosinu tři. Díky tomu lze z jednoho řetězce dopočítat druhý.', deep: 'Chargaff zjistil kolem roku 1950, že v DNA je adeninu tolik co thyminu a guaninu tolik co cytosinu. Watson a Crick z toho a z rentgenových snímků Rosalind Franklinové roku 1953 odvodili dvoušroubovici a hned poznamenali, že párování napovídá, jak se DNA kopíruje.' },
  topo: { n: 2, name: 'Topoizomeráza', what: 'Enzym před vidličkou. Rozplétáním se zbytek šroubovice stále víc nadtáčí, topoizomeráza napětí uvolní tím, že řetězec dočasně přeruší, nechá ho protočit a zase spojí.', deep: 'U bakterií tuhle práci dělá gyráza. Fluorochinolonová antibiotika, například ciprofloxacin, ji blokují, replikace bakteriální DNA se zastaví a buňka hyne. Lidské topoizomerázy jsou cílem některých protinádorových léků, etoposidu a irinotekanu.' },
  hel: { n: 3, name: 'Helikáza', what: 'Enzym tvaru prstence, který se nasune na jeden řetězec a postupuje po něm. Za energii z ATP ruší vodíkové můstky a odděluje řetězce od sebe.', deep: 'Helikáza je šest podjednotek složených do kroužku. U bakterií jede po předloze opožďujícího se řetězce, u člověka komplex MCM po předloze vedoucího. Každý krok po řetězci ji stojí jednu molekulu ATP.' },
  fork: { n: 4, wide: true, name: 'Replikační vidlička', what: 'Místo, kde se dvoušroubovice rozestupuje do písmene Y. Před vidličkou je ještě stará dvoušroubovice, za ní už dvě nové. Vidlička postupuje a za ní zůstávají dvě kopie.', deep: 'Z každého replikačního počátku vyjíždějí dvě vidličky opačným směrem, model sleduje jednu. Bakterie má na kruhovém chromozomu jeden počátek, lidská buňka jich má desítky tisíc. Bakteriální vidlička urazí asi 1000 nukleotidů za sekundu, lidská řádově desítky.' },
  ssb: { n: 5, name: 'SSB proteiny', what: 'Bílkoviny, které obsadí rozpletené jednotlivé řetězce. Brání jim, aby se spojily zpět nebo se samy na sebe zkroutily, a drží je rovné pro polymerázu.', deep: 'Zkratka z anglického single-strand binding. U člověka tuhle roli hraje protein RPA. SSB proteiny také chrání jednořetězcovou DNA před rozštěpením nukleázami.' },
  prim: { n: 6, name: 'Primáza', what: 'Enzym, který na rozpletené předloze vyrobí krátký úsek RNA, primer. Na rozdíl od DNA polymerázy umí začít od nuly, bez předchozího 3′ konce.', deep: 'Primáza je ve skutečnosti RNA polymeráza: píše RNA podle předlohy DNA. U člověka pracuje v komplexu s DNA polymerázou α, která primer hned prodlouží o pár desítek nukleotidů DNA, než práci převezme hlavní polymeráza.' },
  primer: { n: 7, name: 'RNA primer', what: 'Krátký úsek RNA, zpravidla kolem deseti nukleotidů, komplementární k předloze. Poskytuje volný 3′ konec, na který může DNA polymeráza navázat.', deep: 'Primer se později vystřihne a nahradí DNA: u bakterií to zvládne DNA polymeráza I, u člověka spolupracují nukleázy RNáza H a FEN1 s polymerázou δ. Na samém konci lineárního chromozomu nemá poslední primer kdo nahradit; tento problém konců řeší telomeráza, za jejíž objev dostali Blackburnová, Greiderová a Szostak Nobelovu cenu 2009.' },
  pol: { n: 8, zoom: 1.3, back: 'Zpět na polymerázu', name: 'DNA polymeráza', what: 'Hlavní enzym replikace. Čte předlohu, přikládá k ní komplementární nukleotidy a spojuje je do nového řetězce. Pracuje vždy jen jedním směrem: nový řetězec prodlužuje na 3′ konci, roste tedy od 5′ ke 3′.', deep: 'U bakterií kopíruje hlavní část DNA polymeráza III, u člověka polymeráza ε na vedoucím a δ na opožďujícím se řetězci. Polymeráza si po sobě kontroluje chyby: špatně přiložený nukleotid hned odstřihne a zkusí znovu. Arthur Kornberg izoloval první DNA polymerázu roku 1956 a dostal za ni Nobelovu cenu 1959.', subs: ['oh', 'ntp', 'ppi'] },
  oh: { n: 'a', parent: 'pol', name: 'Rostoucí 3′ konec', what: 'Poslední nukleotid nového řetězce nese na třetím uhlíku cukru volnou skupinu –OH. Právě ta zaútočí na přicházející nukleotid a vznikne nová vazba.', deep: 'Vazba mezi cukrem jednoho a fosfátem dalšího nukleotidu se jmenuje fosfodiesterová. Když polymeráza přiloží špatný nukleotid, odstřihne ho svou 3′→5′ exonukleázovou aktivitou a pokračuje. Podle Albertsovy učebnice je právě tahle oprava důvodem, proč syntéza jde jen jedním směrem: po odstřižení na 3′ konci zůstane –OH a jde pokračovat, kdežto 5′ konec by přišel o fosfáty s energií a řetězec by se zastavil.' },
  ntp: { n: 'b', parent: 'pol', name: 'Přicházející nukleotid', what: 'Stavební kámen přichází jako deoxynukleosidtrifosfát, s bází a třemi fosfáty. Polymeráza ho přiloží proti bázi předlohy, a když páruje správně, spojí ho s 3′ koncem.', deep: 'Energii pro vazbu nese nukleotid sám ve vazbách mezi svými fosfáty. Proto nový řetězec nemůže růst na 5′ konci: tam by musela být energie uložena na konci řetězce a každá oprava by ji odnesla. Čtyři stavební kameny jsou dATP, dTTP, dGTP a dCTP.' },
  ppi: { n: 'c', parent: 'pol', name: 'Pyrofosfát', what: 'Dva fosfáty, které se při vzniku vazby odštěpí a odcházejí pryč. Zůstává jen jeden, zabudovaný v kostře nového řetězce.', deep: 'Pyrofosfát se v buňce ihned štěpí na dva fosfáty, což reakci posune nevratně dopředu. Stejný trik, odštěpení pyrofosfátu, pohání i syntézu RNA a aktivaci aminokyselin pro tvorbu bílkovin.' },
  lead: { n: 9, name: 'Vedoucí řetězec', what: 'Nový řetězec, který roste souvisle směrem k vidličce. Stačí mu jediný primer a jedna polymeráza, která jede za helikázou.', deep: 'Vedoucí a opožďující se řetězec se liší jen polohou vůči vidličce. Tentýž mateřský řetězec je předlohou vedoucího řetězce pro jednu vidličku a opožďujícího se pro druhou, která z počátku vyjela na opačnou stranu.' },
  lag: { n: 10, name: 'Opožďující se řetězec', what: 'Nový řetězec, který vzniká po kouscích směrem od vidličky, protože směr od 5′ ke 3′ tu vede od vidličky pryč. Skládá se z Okazakiho fragmentů, které spojí ligáza.', deep: 'Aby polymeráza opožďujícího se řetězce nezůstávala pozadu, je jeho předloha ve skutečnosti ohnutá do smyčky a obě polymerázy jedou vedle sebe v jednom komplexu, replizomu. Model smyčku nekreslí, aby zůstal čitelný.' },
  oka: { n: 11, name: 'Okazakiho fragment', what: 'Jeden kousek opožďujícího se řetězce: RNA primer a za ním úsek DNA. U člověka je dlouhý asi 100 až 200 nukleotidů, u bakterií 1000 až 2000.', deep: 'Reiji a Tsuneko Okazakiovi je objevili roku 1968: krátce označili DNA bakterie Escherichia coli radioaktivním thymidinem a nová DNA se nejdřív objevila v krátkých kouscích, které se teprve po chvíli spojily do dlouhých řetězců. Lidská buňka jich při jednom dělení vyrobí desítky milionů.' },
  lig: { n: 12, name: 'DNA ligáza', what: 'Enzym, který spojí zářez mezi dvěma úseky: vytvoří fosfodiesterovou vazbu mezi 3′ koncem jednoho a 5′ koncem druhého. Z fragmentů tak vznikne jeden souvislý řetězec.', deep: 'Ligáza na to potřebuje energii z ATP, bakteriální z NAD⁺. Stejný enzym spojuje konce i při opravách DNA a v laboratoři se používá k vkládání genů do plazmidů, je to základní nástroj genového inženýrství.' },
}

const POL = glass('polG', 'envelope')
const FINDABLE = ['dna', 'topo', 'hel', 'fork', 'ssb', 'prim', 'primer', 'pol', 'lead', 'lag', 'oka', 'lig']

export default defineLesson({
  meta: meta as Meta,
  tracks: [{ id: 'vidlicka', name: 'Replikace', label: 'Replikace DNA', steps: STEPS }],
  parts: PARTS,
  layers: [
    { id: 'old', label: 'mateřské řetězce', swatches: ['old'] },
    { id: 'new', label: 'nové řetězce DNA', swatches: ['new'] },
    { id: 'primer', label: 'RNA primery', swatches: ['primer'] },
    { id: 'prot', label: 'enzymy a bílkoviny', swatches: ['enz', 'ssb'] },
  ],
  // one colour, one meaning: Prussian blue for the old strands, carmine for the new, violet for RNA, verdigris for enzymes, ochre where it happens
  palette: pigments({ old: 'prussian', new: 'carmine', primer: 'violet', enz: 'verdigris', ssb: 'mauve', act: 'ochre', ink: 'ink' }, POL),
  findable: () => FINDABLE,
  scene: (s, g) => drawFork(s.step + s.f, s, g),
  numbers(_track, step, f) {
    const [primers, frags, helices] = counts(state(step + f))
    return [{ label: 'primerů RNA', value: primers }, { label: 'Okazakiho fragmentů', value: frags }, { label: 'dvoušroubovic', value: helices }]
  },
  numbersNote: 'Model má jen čtyři fragmenty, aby se daly spočítat. U člověka jich na jednu vidličku připadají stovky až tisíce.',
  extras: [
    { title: 'Vedoucí a opožďující se řetězec vedle sebe', html: `<table>
    <thead><tr><th></th><th>Vedoucí řetězec</th><th>Opožďující se řetězec</th></tr></thead>
    <tbody>
      <tr><th>Směr syntézy</th><td>od 5′ ke 3′, k vidličce</td><td>od 5′ ke 3′, od vidličky pryč</td></tr>
      <tr><th>Jak vzniká</th><td>souvisle, jedním tahem</td><td>po kouscích, v Okazakiho fragmentech</td></tr>
      <tr><th>Primerů</th><td>jeden</td><td>jeden na každý fragment</td></tr>
      <tr><th>Délka fragmentů</th><td>–</td><td>u člověka asi 100 až 200 nukleotidů, u bakterií 1000 až 2000</td></tr>
      <tr><th>Co je potřeba navíc</th><td>–</td><td>výměna primerů za DNA a ligáza</td></tr>
    </tbody>
  </table>` },
    { title: 'Enzymy replikace v pořadí', html: `<table>
    <thead><tr><th>Enzym</th><th>Co dělá</th></tr></thead>
    <tbody>
      <tr><th>Topoizomeráza (u bakterií gyráza)</th><td>uvolňuje napětí šroubovice před vidličkou</td></tr>
      <tr><th>Helikáza</th><td>rozplétá dvoušroubovici, ruší vodíkové můstky</td></tr>
      <tr><th>SSB proteiny</th><td>drží rozpletené řetězce od sebe (nejsou enzym)</td></tr>
      <tr><th>Primáza</th><td>syntetizuje RNA primer</td></tr>
      <tr><th>DNA polymeráza</th><td>prodlužuje 3′ konec podle předlohy, kontroluje chyby</td></tr>
      <tr><th>DNA polymeráza I / nukleázy</th><td>odstraní primer a nahradí ho DNA</td></tr>
      <tr><th>DNA ligáza</th><td>spojí zářezy mezi fragmenty</td></tr>
    </tbody>
  </table>` },
  ],
  note: 'Semikonzervativní replikaci navrhli Watson a Crick roku 1953 a Meselson se Stahlem ji roku 1958 prokázali pokusem s těžkým dusíkem. Okazakiho fragmenty popsali manželé Okazakiovi roku 1968. Model zjednodušuje: kreslí jednu vidličku, čtyři fragmenty a deset párů bází na závit, primery a fragmenty nejsou v měřítku a předloha opožďujícího se řetězce není ohnutá do smyčky. Mezerník spouští a zastavuje přehrávání.',
  pronounce: { '5′': 'pět čárka', '3′': 'tři čárka', '3′-OH': 'tři čárka ó há', DNA: 'dé en á', RNA: 'er en á', SSB: 'es es bé', I: 'jedna', Y: 'ypsilon', ATP: 'á té pé' },
  words: { back: 'Zpět na celou vidličku', partsTitle: 'Části modelu', tapPart: 'Ťukni v modelu na tečku, která k ní patří.', spot: 'část modelu', whichStep: 'Který krok to je?', orderTitle: 'Jak jdou kroky po sobě?', findStep: 'Posuň čas tam, kde tenhle krok probíhá, a potvrď.', later: 'Hledaný krok je později.', earlier: 'Hledaný krok je dřív.' },
})
