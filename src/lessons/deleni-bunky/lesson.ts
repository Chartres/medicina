// Buněčný cyklus a dělení buněk — the texts, in the terms of the learner's workbook, and the wiring
// of the cell model (model.js) to the kit.
import { defineLesson, type Part, type SceneOut, type Step } from '../../kit/types.ts'
import { lerp } from '../../kit/math.ts'
import { glass, pigments } from '../../kit/pigments.ts'
import { drawCells, stats } from './model.js'
import { meta } from './meta.ts'

type Kind = 'mit' | 'mei1' | 'mei2'
type Phase = Step & { kind: Kind; u0: number; u1: number }
// one row per step: name, phase of the model it shows (kind, from u0 to u1), weight on the time strip, then the texts
const T = (name: string, kind: Kind, u0: number, u1: number, weight: number, tip: string, desc: string, q: string, a: string, etym: string): Phase => ({ name, kind, u0, u1, weight, tip, desc, q, a, etym })
const INTER='Latinsky inter znamená mezi. Je to období mezi dvěma děleními. ';
const E={inter:INTER+'Samotné slovo mitóza pochází z řeckého mitos, vlákno.',
  pro:'Řecky pro znamená před. Je to první fáze, před vším ostatním.',meta:'Řecky meta znamená po, za. Je to fáze, která přichází po profázi. Pomůcka: v metafázi jsou chromozomy uprostřed.',
  ana:'Řecky ana znamená vzhůru, zpět. Chromozomy jdou od středu pryč.',telo:'Řecky telos znamená konec.',
  mei:INTER+'Slovo meióza pochází z řeckého meiosis, zmenšení. Počet chromozomů klesne na polovinu.'};
const MODES: Record<string, Phase[]> = {
 mitoza:[
  T('G₁ fáze','mit',0,.35,.9,'Menší buňka, jeden centrozom, chromatin v jedné kopii.','Buňka po předchozím dělení roste, vyrábí RNA a bílkoviny a přibývá jí organel. Na konci je kontrolní bod K₁: buňka ověří, že je připravená zdvojit DNA. Buňka, která se dál dělit nemá, odejde do klidové fáze G₀ a jen vykonává svou funkci, dočasně nebo natrvalo.','Které buňky těla zůstávají v G₀ nejdéle?','Například nervové a svalové. Po dozrání se už většinou nedělí.','G je z anglického gap, mezera: období mezi dělením a zdvojením DNA. Fázím G₁, S a G₂ se dohromady říká interfáze, z latinského inter, mezi.'),
  T('S fáze','mit',.35,.9,.9,'Po vláknech chromatinu běží oranžové značky: DNA se kopíruje.','Probíhá replikace DNA. Každý chromozom má potom dvě sesterské chromatidy spojené v centromeře. Počet chromozomů se nemění, zdvojnásobí se jen množství DNA. Zdvojí se i centrozom.','Proč musí buňka zdvojit DNA dřív, než se začne dělit?','Aby každá dceřiná buňka dostala úplnou sadu. Bez zdvojení by na každou zbyla jen polovina.','S je ze slova syntéza: buňka syntetizuje novou DNA.'),
  T('G₂ fáze','mit',.9,1,.6,'Velká buňka, dva centrozomy, chromatin už ve dvou kopiích.','Buňka dál roste a vyrábí bílkoviny a organely, aby jich bylo dost pro obě dceřiné buňky. Kontrolní bod K₂ ověří, že je DNA zkopírovaná správně. Teprve potom začne mitóza.','Co se stane, když kontrolní bod najde poškozenou DNA?','Cyklus se zastaví a buňka DNA opraví. Když to nejde, spustí řízenou smrt, apoptózu. Když kontrolní body selžou, může vzniknout nádor.','Druhá mezera, gap: období mezi zdvojením DNA a mitózou.'),
  T('Profáze','mit',1,3,1.7,'Chromozomy se zviditelňují, jaderný obal se rozpadá.','Chromatin se spiralizuje do krátkých tlustých chromozomů. Centrozomy se rozcházejí k opačným pólům a mezi nimi vzniká dělicí vřeténko. Jadérko mizí. Na konci se rozpadne jaderný obal a vlákna vřeténka se chytí chromozomů. Některé učebnice tenhle závěr vyčleňují jako prometafázi.','Proč musí jaderný obal zmizet?','Vřeténko vzniká v cytoplazmě. Dokud je obal celý, vlákna na chromozomy nedosáhnou.',E.pro),
  T('Metafáze','mit',3,4,.8,'Chromozomy srovnané v jedné rovině uprostřed.','Chromozomy leží v ekvatoriální rovině, destičce, uprostřed buňky. Každá chromatida je připojená k jinému pólu. Jsou teď nejkratší a nejlépe vidět, proto se z metafáze dělá karyotyp. Buňka čeká, dokud nejsou připojené všechny.','Co by se stalo, kdyby se jeden chromozom nepřipojil a anafáze přesto začala?','Jedna buňka by měla chromozom navíc a druhé by chyběl. Chybnému počtu chromozomů se říká aneuploidie. Proto buňka v metafázi čeká na všechny.',E.meta),
  T('Anafáze','mit',4,5,1,'Dvě skupiny tvaru V putují od sebe.','Centromery se rozdělí a vlákna táhnou sesterské chromatidy k opačným pólům. Od této chvíle je každá chromatida samostatný chromozom, takže jich je na chvíli dvojnásobek. Buňka se protahuje.','DNA nepřibyla, a přesto se teď počítá osm chromozomů místo čtyř. Proč?','Chromozomy se počítají podle centromer. Jakmile se centromera rozdělí, je každá chromatida samostatný chromozom.',E.ana),
  T('Telofáze','mit',5,6,1,'U pólů vznikají dvě nová jádra.','Chromozomy u pólů se rozvolňují zpět na chromatin. Kolem obou skupin vzniká jaderný obal, vrací se jadérko a vřeténko zaniká. Zároveň už začíná cytokineze.','Telofáze vypadá jako profáze pozpátku. Co všechno se vrací?','Chromozomy se rozvolní, složí se jaderný obal, objeví se jadérko a vřeténko se rozpadne.',E.telo),
  T('Cytokineze','mit',6,7,1,'Buňka se zaškrcuje na dvě.','Jádro je rozdělené, teď se dělí cytoplazma. Živočišnou buňku zaškrtí prstenec z aktinu a myozinu, rostlinná staví od středu přepážku. Vzniknou dvě buňky 2n, geneticky shodné s tou původní.','Proč se rostlinná buňka nemůže zaškrtit?','Brání jí pevná buněčná stěna. Staví proto novou přepážku od středu ke krajům.','Řecky kytos je dutina, nádoba, v biologii buňka. Kinesis je pohyb.'),
 ],
 meioza:[
  T('Interfáze','mei1',0,1,1,'Jedno velké jádro, chromozomy nejsou vidět.','Stejná příprava jako před mitózou. DNA se zdvojí jen teď, před prvním dělením. Před druhým už ne.','Meióza má dvě dělení, ale DNA se zdvojí jen jednou. Co to udělá s počtem chromozomů?','Klesne na polovinu, z 2n na n. Při oplození se dvě poloviční sady zase spojí.',E.mei),
  T('Profáze I','mei1',1,3,1.9,'Homologní chromozomy leží v párech těsně u sebe.','Chromozom od matky a jeho protějšek od otce se k sobě přiloží a vytvoří bivalent. Nesesterské chromatidy si při crossing-overu vymění úseky, tím vznikají nové kombinace alel. Je to nejdelší fáze meiózy. Na konci se rozpadá jaderný obal.','K čemu je dobré, že si chromozomy vymění úseky?','Na jednom chromozomu se tak sejdou alely od matky i od otce. I proto nejsou sourozenci stejní.',E.pro),
  T('Metafáze I','mei1',3,4,.8,'Uprostřed leží páry chromozomů, ne jednotlivé chromozomy.','V ekvatoriální rovině stojí celé bivalenty. Který z páru se natočí ke kterému pólu, je náhoda. Tomu se říká nezávislá kombinace chromozomů.','V modelu jsou dva páry. Kolik různých gamet může jen jejich natočením vzniknout?','Čtyři. U člověka s 23 páry je to 2²³, přes osm milionů.',E.meta),
  T('Anafáze I','mei1',4,5,1,'K pólům jdou celé chromozomy, každý se dvěma chromatidami.','Rozcházejí se homologní chromozomy, každý pořád se dvěma chromatidami. Centromery se nedělí. Homologní páry se tu rozdělí, takže každá dceřiná buňka dostane jen polovinu chromozomů.','Čím se tahle anafáze liší od anafáze mitózy?','Centromery se nedělí. K pólům jdou celé chromozomy se dvěma chromatidami, od každého páru jeden.',E.ana),
  T('Telofáze I','mei1',5,7,1.4,'Buňka se zaškrcuje, v každé polovině je půlka chromozomů.','Vzniknou dvě haploidní buňky. Každý chromozom má stále dvě chromatidy a díky crossing-overu už nejsou stejné. Někdy následuje krátká pauza, interkineze. DNA se ale už nezdvojuje.','Buňky jsou už haploidní, a přesto je čeká další dělení. Proč?','Každý chromozom má pořád dvě chromatidy. Druhé dělení je od sebe oddělí.',E.telo),
  T('Profáze II','mei2',1,3,1.3,'Dvě buňky, v každé se znovu objevují chromozomy.','V obou buňkách se chromozomy znovu spiralizují a rozpadá se jaderný obal. Staví se nové vřeténko, obvykle kolmo na to první.','Co před tímhle dělením chybí oproti mitóze?','S-fáze. DNA se znovu nezdvojuje.',E.pro),
  T('Metafáze II','mei2',3,4,.8,'Dvě buňky, chromozomy jednotlivě v řadě.','Chromozomy se řadí do ekvatoriální roviny jednotlivě, stejně jako při mitóze. Jen jich je polovina.','Jsou sesterské chromatidy pořád stejné?','Ne úplně. Po crossing-overu nese jedna z nich vyměněný úsek. V modelu ho poznáš podle barvy.',E.meta),
  T('Anafáze II','mei2',4,5,1,'Dvě buňky, v každé se rozcházejí chromatidy.','Teprve teď se dělí centromery. Sesterské chromatidy se rozcházejí k opačným pólům jako při mitóze.','Kolik chromozomů bude mít každá ze čtyř buněk?','Dva, tedy n. V každé jeden dlouhý a jeden krátký.',E.ana),
  T('Telofáze II','mei2',5,7,1.4,'Vznikají čtyři buňky.','Kolem čtyř skupin chromozomů vznikají jádra a buňky se zaškrtí. Výsledkem jsou čtyři haploidní buňky a každá je geneticky jiná. U živočichů z nich budou gamety, u rostlin spory.','U muže vzniknou z jedné buňky čtyři spermie. Kolik vajíček vznikne u ženy?','Jedno. Cytoplazma se dělí nerovnoměrně. Zbytek tvoří malá pólová tělíska, která zaniknou.',E.telo),
 ]};
// numbered parts, numbers fixed across phases (Comenius: the numeral in the picture is the numeral in the text)
const PARTS: Record<string, Part> = {
 mem:{n:1,wide:true,name:'Buněčná membrána',what:'Tenký obal z fosfolipidů a bílkovin. Odděluje buňku od okolí a hlídá, co jde dovnitř a ven.',deep:'Při cytokinezi ji zevnitř stahuje prstenec z aktinu a myozinu. Rostlinná buňka má navíc pevnou buněčnou stěnu, proto se nezaškrcuje a staví přepážku od středu.'},
 obal:{n:2,name:'Jaderný obal',what:'Dvojitá membrána s póry kolem jádra. Odděluje DNA od cytoplazmy.',deep:'V prometafázi se rozpadne na váčky, protože se fosforylují laminy, bílkoviny, které ho zevnitř vyztužují. V telofázi se z váčků znovu složí kolem chromozomů.'},
 jad:{n:3,name:'Jadérko',what:'Hustá oblast jádra, kde vzniká ribozomální RNA a skládají se podjednotky ribozomů. Nemá vlastní membránu.',deep:'Během dělení mizí, protože se zastaví přepis genů pro rRNA. V telofázi se znovu objeví u úseků chromozomů, kterým se říká organizátory jadérka.'},
 chrom:{n:4,zoom:1.05,back:'Zpět na chromozom',name:'Chromozom',what:'DNA namotaná na bílkoviny histony, dohromady chromatin. Při dělení se chromatin těsně sbalí do chromozomu, aby se dal přesunout a nepotrhal se. Po zdvojení tvoří chromozom dvě sesterské chromatidy spojené v centromeře.',deep:'Sbalení zajišťuje bílkovinný komplex kondenzin. DNA lidského chromozomu 1 by natažená měřila asi 8,5 cm, v metafázi má jen několik mikrometrů.',subs:['kin','chd','koh']},
 kin:{n:'a',parent:'chrom',name:'Centromera a kinetochor',what:'Centromera je zaškrcené místo, kde chromatidy drží nejdéle. Na každé chromatidě na ní sedí kinetochor, bílkovinná destička, za kterou se chytá vlákno vřeténka.',deep:'Dokud nejsou připojené všechny kinetochory, kontrolní bod vřeténka nedovolí anafázi začít.'},
 chd:{n:'b',parent:'chrom',name:'Sesterské chromatidy',what:'Dvě stejné kopie téhož chromozomu. Vznikly zdvojením DNA v S-fázi a až do anafáze drží u sebe.',deep:'Po crossing-overu v meióze už stejné nejsou: jedna nese úsek z homologního chromozomu.'},
 koh:{n:'c',parent:'chrom',name:'Kohezin',what:'Bílkovinné kroužky, které drží sesterské chromatidy u sebe. Na začátku anafáze je rozstřihne enzym separáza a chromatidy se mohou rozejít.',deep:'V anafázi I se rozstřihne jen kohezin na ramenech, u centromery zůstane chráněný. Proto se rozcházejí celé chromozomy a chromatidy až v meióze II.'},
 cen:{n:5,name:'Centrozom',what:'Organizační centrum mikrotubulů. V živočišné buňce ho tvoří dvě centrioly obalené bílkovinnou hmotou. Vyrůstají z něj vlákna dělicího vřeténka.',deep:'Zdvojuje se v interfázi, podobně jako DNA. Vyšší rostliny centrioly nemají a vřeténko postaví i bez nich.'},
 vret:{n:6,name:'Dělicí vřeténko',what:'Soustava vláken z bílkoviny tubulinu, mikrotubulů. Část se chytá chromozomů a táhne je, část se opírá o vlákna z druhého pólu a póly od sebe odtlačuje.',deep:'Chromozom se pohybuje hlavně tím, že se vlákno u kinetochoru rozpadá a zkracuje. Kolchicin stavbu mikrotubulů blokuje a zastaví dělení v metafázi. Toho se využívá při sestavování karyotypu.'},
 rov:{n:7,wide:true,name:'Ekvatoriální rovina',what:'Myšlená rovina uprostřed mezi póly. Chromozomy se v ní srovnají, protože se tam tah a tlak vláken od obou pólů vyrovnají.',deep:'Při pohledu od pólu tvoří chromozomy mitózy hvězdici. Flemming téhle podobě říkal hvězda, německy Stern.',act:{label:'Podívat se od pólu',az:Math.PI/2}},
 prst:{n:8,name:'Kontraktilní prstenec',what:'Pás vláken aktinu a myozinu těsně pod membránou. Stahuje se jako šňůrka u pytlíku a buňku zaškrtí.',deep:'Stejné dvě bílkoviny, aktin a myozin, stahují i svaly. Tam jsou jen uspořádané do pevných svazků.'},
 biv:{n:9,name:'Bivalent',what:'Pár homologních chromozomů přiložených těsně k sobě. Má dohromady čtyři chromatidy, proto se mu říká i tetráda.',deep:'Homology k sobě po celé délce spojuje synaptonemální komplex. Profáze I se podle vzhledu chromozomů dělí na leptotene, zygotene, pachytene, diplotene a diakinezi.'},
 chi:{n:10,name:'Crossing-over',what:'Nesesterské chromatidy se zlomí ve stejném místě a spojí se křížem. Vymění si tak úseky s geny od matky a od otce. Místu překřížení se říká chiasma.',deep:'Na každém páru proběhne zpravidla aspoň jedno překřížení, u člověka obvykle jedno až tři. Chiasmata zároveň drží homology pohromadě až do anafáze I.'},
};

const MEM = glass('mem', 'membrane'), NUC = glass('nuc', 'envelope')
const FINDABLE = ['mem', 'obal', 'jad', 'chrom', 'cen', 'vret', 'rov', 'prst']

export default defineLesson({
  meta,
  tracks: [
    { id: 'mitoza', name: 'Mitóza', label: 'Buněčný cyklus', steps: MODES.mitoza },
    { id: 'meioza', name: 'Meióza', label: 'Meióza', steps: MODES.meioza.map((s) => ({ ...s, short: s.name.replace('fáze', '') })) },
  ],
  parts: PARTS,
  layers: [
    { id: 'chrom', label: 'chromozomy od matky a od otce', swatches: ['m', 'p'] },
    { id: 'spindle', label: 'vřeténko', swatches: ['tub'] },
    { id: 'nucleus', label: 'jádro' },
    { id: 'membrane', label: 'membrána' },
  ],
  // a stained preparation: carmine and Prussian blue for the two parental sets, sepia spindle
  palette: pigments({ m: 'carmine', p: 'prussian', tub: 'sepia', act: 'ochre', cen: 'umber', kin: 'ink', nl: 'mauve', plate: 'slate' },
    { paper: { ...MEM.paper, ...NUC.paper }, fluo: { ...MEM.fluo, ...NUC.fluo } }),
  findable: (track) => (track === 'meioza' ? [...FINDABLE, 'biv', 'chi'] : FINDABLE),
  scene(s, g) {
    const ph = MODES[s.track][s.step]
    return drawCells(ph.kind, lerp(ph.u0, ph.u1, s.f), s, g) as SceneOut
  },
  numbers(track, step, f) {
    const ph = MODES[track][step], [chr, dna, set] = stats(ph.kind, lerp(ph.u0, ph.u1, f))
    return [{ label: 'chromozomů v buňce', value: chr }, { label: 'molekul DNA', value: dna }, { label: 'sada', value: set }]
  },
  numbersNote: 'Model má 2n = 4, aby se dal uhlídat. Člověk má 2n = 46.',
  extras: [{ title: 'Mitóza a meióza vedle sebe', html: `<table>
    <thead><tr><th></th><th>Mitóza</th><th>Meióza</th></tr></thead>
    <tbody>
      <tr><th>Kde probíhá</th><td>hlavně tělní (somatické) buňky</td><td>pohlavní orgány při vzniku gamet, u rostlin spor</td></tr>
      <tr><th>Počet dělení</th><td>jedno</td><td>dvě po sobě, DNA se zdvojí jen před prvním</td></tr>
      <tr><th>Výsledek</th><td>2 buňky</td><td>4 buňky</td></tr>
      <tr><th>Sada chromozomů</th><td>2n → 2n</td><td>2n → n</td></tr>
      <tr><th>Crossing-over</th><td>ne</td><td>ano, v profázi I</td></tr>
      <tr><th>Co se rozchází v anafázi</th><td>sesterské chromatidy</td><td>v anafázi I celé homologní chromozomy, v anafázi II chromatidy</td></tr>
      <tr><th>Dceřiné buňky</th><td>geneticky shodné s mateřskou</td><td>každá jiná</td></tr>
      <tr><th>K čemu slouží</th><td>růst, obnova tkání, nepohlavní rozmnožování</td><td>pohlavní rozmnožování a genetická variabilita</td></tr>
    </tbody>
  </table>` }],
  note: `Mitózu podrobně popsal a nakreslil Walther Flemming na přelomu 70. a 80. let 19. století podle buněk mločích larev. Roku 1882 jí dal jméno. Hmotu jádra, která se dobře barvila, nazval chromatin, z řeckého chroma, barva. Mezerník spouští a zastavuje přehrávání. Lekce má i <a href="v1/">původní plochou verzi</a>.`,
  pronounce: { 'G₁': 'gé jedna', 'G₂': 'gé dvě', 'G₀': 'gé nula', S: 'es', 'K₁': 'ká jedna', 'K₂': 'ká dvě', 'S-fázi': 'es fázi', '2n': 'dvě en', n: 'en', 'crossing-overu': 'krosing ouvru', 'crossing-over': 'krosing ouvr' },
  words: { back: 'Zpět na celou buňku', partsTitle: 'Části buňky', tapPart: 'Ťukni v buňce na tečku, která k ní patří.', spot: 'část buňky' },
})
