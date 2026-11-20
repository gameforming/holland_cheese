(function () {
  const games = [
    {id:'air', title:'Luchtmacht: onderscheppen', icon:'✈️', category:'Leger', tone:'army', difficulty:'Normaal', duration:75, base:18, rate:.65, max:100, description:'Bestuur een interceptor, ontwijk niets ingewikkelds en schiet de oefendoelen uit de lucht.', controls:'Beweeg met A/D of ←/→. Richt met je muis en klik of druk op spatie om te schieten.', instructions:['Beweeg je vliegtuig langs de onderkant van het scherm.','Schiet op de bewegende oefendoelen.','Elk geraakt doel levert punten op; mis geen tijd met richten.']},
    {id:'tank', title:'Tankcommandant', icon:'🪖', category:'Leger', tone:'army', difficulty:'Expert', duration:90, base:25, rate:.78, max:100, description:'Rijd met een tank over het oefenterrein en schiet op bewegende schietschijven.', controls:'Rijd met WASD of pijltjes. Richt met de muis en klik of druk op spatie om te vuren.', instructions:['Verplaats je tank over het terrein.','Richt de koepel met de muis op de oefenschijven.','Schiet voordat een schijf uit beeld verdwijnt.']},
    {id:'radar', title:'Radaroperator', icon:'📡', category:'Leger', tone:'army', difficulty:'Normaal', duration:60, base:17, rate:.58, max:100, description:'Herken op de radar het juiste vliegtuig, voertuig of schip tussen de signalen.', controls:'Klik op het juiste doeltype dat bovenaan wordt gevraagd.', instructions:['Lees welk toestel of voertuig je moet opsporen.','Kies het juiste radarsignaal uit vier opties.','Werk snel en voorkom verkeerde meldingen.']},
    {id:'supply', title:'Bevoorradingsdropping', icon:'🪂', category:'Leger', tone:'army', difficulty:'Expert', duration:60, base:22, rate:.68, max:100, description:'Laat de bevoorradingskist precies in de gemarkeerde landingszone vallen.', controls:'Druk op Drop supplies wanneer de marker boven de landingszone staat.', instructions:['Let op de bewegende marker.','Laat de kist los wanneer de marker in de groene zone staat.','Hoe nauwkeuriger je timing, hoe meer punten.']},
    {id:'sort', title:'Tulpen sorteren', icon:'🌷', category:'Beginner', tone:'easy', difficulty:'Makkelijk', duration:45, base:8, rate:.38, max:100, description:'Een rustig spelletje: zoek steeds de juiste kleur tulp tussen vier keuzes.', controls:'Klik op de tulp met de kleur die bovenaan gevraagd wordt.', instructions:['Bekijk de gevraagde kleur.','Klik op de juiste tulp.','Je krijgt meer punten voor snelle, goede keuzes.']},
    {id:'quiz', title:'Nederland-kenner', icon:'🇳🇱', category:'Beginner', tone:'easy', difficulty:'Makkelijk', duration:75, base:12, rate:.56, max:100, description:'Beantwoord korte vragen over Nederlandse plaatsen, sport, cultuur en geschiedenis.', controls:'Kies één van de vier antwoorden.', instructions:['Lees de vraag.','Kies het antwoord dat volgens jou klopt.','Er zijn maximaal tien vragen.']},
    {id:'penalty', title:'Penalty challenge', icon:'⚽', category:'Sport', tone:'easy', difficulty:'Normaal', duration:60, base:14, rate:.54, max:100, description:'Neem strafschoppen en probeer de keeper te slim af te zijn.', controls:'Kies links, midden of rechts om te schieten.', instructions:['De keeper kiest een hoek.','Kies een andere hoek om te scoren.','Je krijgt acht kansen.']},
    {id:'courier', title:'Fietskoerier', icon:'🚲', category:'Nederland', tone:'easy', difficulty:'Makkelijk', duration:60, base:10, rate:.48, max:100, description:'Bezorg pakketjes door de stad, pak bestellingen op en ontwijk pionnen.', controls:'Gebruik de drie rijstrookknoppen of toetsen A/S/D.', instructions:['Wissel van rijstrook om obstakels te ontwijken.','Rijd door pakketjes om ze te bezorgen.','Elke bezorging levert punten op.']},
    {id:'dike', title:'Dijkbewaking', icon:'🌊', category:'Nederland', tone:'easy', difficulty:'Normaal', duration:60, base:14, rate:.52, max:100, description:'Dicht snel de kleine lekkages voordat het water over de dijk stroomt.', controls:'Klik op de lichtgevende lekplekken zodra ze verschijnen.', instructions:['Let op de vier dijkvakken.','Klik op elk lek om het te dichten.','Snelle reacties leveren meer punten op.']},
    {id:'logistics', title:'Havenlogistiek', icon:'🚢', category:'Werk', tone:'easy', difficulty:'Normaal', duration:60, base:16, rate:.55, max:100, description:'Sorteer binnenkomende lading naar de juiste bestemming in de haven.', controls:'Klik op de juiste bestemming voor de getoonde lading.', instructions:['Lees het type lading.','Kies de juiste bestemming.','Fouten kosten tijd, goede sorteringen leveren punten op.']}
  ];

  const companies = [
    ['lemonade','🍋','Limonadekraam','Horeca','Een kleine kraam met frisse limonade.','50',.50],
    ['lawn','🌱','Grasmaaiservice','Dienstverlening','Maai gazons in de buurt.','90',.80],
    ['wors','🥖','Brabants Worstenbroodje-kraam','Horeca','Een kleine Brabantse snackkraam.','180',1.10],
    ['fiets','🚲','Fietsreparatie aan huis','Techniek','Repareer lekke banden en kettingen.','300',1.50],
    ['fries','⛵','Friese Sloepverhuur','Toerisme','Verhuur sloepen voor een rondje over het water.','420',2.00],
    ['coffee','☕','Koffiekar','Horeca','Koffie voor forenzen en studenten.','650',2.80],
    ['friet','🍟','Frietzaak','Horeca','Een lokale snackbar met vaste klanten.','850',3.50],
    ['tulip','🌷','Tulpenkraam','Landbouw','Verkoop bloemen op de markt.','1100',4.50],
    ['clean','🧽','Schoonmaakbedrijf','Dienstverlening','Kantoren en woningen schoonmaken.','1600',6.20],
    ['bakery','🥐','Stroopwafelbakkerij','Productie','Bak verse stroopwafels voor winkels.','2200',8.00],
    ['plumber','🔧','Loodgietersbedrijf','Bouw','Kleine installaties en spoedreparaties.','3000',10.50],
    ['paint','🖌️','Schildersbedrijf','Bouw','Binnen- en buitenschilderwerk.','3800',13.00],
    ['barber','✂️','Kapsalon','Dienstverlening','Een buurtkapsalon met terugkerende klanten.','4700',15.00],
    ['flower','💐','Bloemenwinkel','Retail','Een eigen bloemenwinkel met bezorging.','6000',19.00],
    ['electric','⚡','Elektro-installatiebedrijf','Techniek','Elektrische installaties en onderhoud.','7800',24.00],
    ['roof','🏠','Dakdekkersbedrijf','Bouw','Renoveer daken en plaats isolatie.','10500',31.00],
    ['gym','🏋️','Sportschool','Sport','Een sportschool met abonnementen.','14000',42.00],
    ['football','⚽','Lokale voetbalclub','Sport','Contributie, trainingen en wedstrijddagen.','19000',55.00],
    ['cafe','🍻','Bruin café','Horeca','Een gezellig café met vaste gasten.','25000',72.00],
    ['canal','🛶','Grachtenrondvaart','Toerisme','Rondvaarten door een historische binnenstad.','33000',95.00],
    ['bikebrand','🚴','Fietsenmerk','Productie','Ontwerp en verkoop stadsfietsen.','45000',130.00],
    ['farm','🚜','Melkveehouderij','Landbouw','Een moderne boerderij met eigen productie.','60000',175.00],
    ['florist','🌼','Bloemenexporteur','Handel','Lever bloemen aan groothandels in Europa.','80000',235.00],
    ['transport','🚚','Transportbedrijf','Logistiek','Een kleine vloot bestelwagens en vrachtwagens.','110000',320.00],
    ['hotel','🏨','Boutiquehotel','Toerisme','Een hotel voor toeristen en zakenreizigers.','150000',440.00],
    ['construction','🏗️','Bouwbedrijf','Bouw','Renoveer en bouw woningen en kantoren.','205000',600.00],
    ['shipyard','⚓','Scheepswerf','Industrie','Onderhoud en bouw binnenvaartschepen.','280000',820.00],
    ['wind','🌬️','Windenergiepark','Energie','Lever stroom uit een eigen windpark.','380000',1120.00],
    ['supermarket','🛒','Supermarkt','Retail','Een supermarkt met dagelijkse boodschappen.','520000',1550.00],
    ['housing','🏘️','Vastgoedbeheer','Vastgoed','Verhuur en beheer van wooncomplexen.','700000',2100.00],
    ['robotics','🤖','Robotics startup','Technologie','Bouw robots voor logistiek en productie.','950000',2900.00],
    ['aiagency','🧠','AI-adviesbureau','Technologie','Automatiseer processen voor andere bedrijven.','1300000',4050.00],
    ['software','💻','Softwarebedrijf','Technologie','Ontwikkel software en digitale diensten.','1800000',5600.00],
    ['cyber','🛡️','Cybersecuritybedrijf','Technologie','Beveilig netwerken en bedrijfsdata.','2500000',7900.00],
    ['chip','🔬','Chipfabriek','Industrie','Produceer geavanceerde halfgeleiders.','3400000',10800.00],
    ['cloud','☁️','Cloud datacenter','Technologie','Verhuur rekenkracht en opslag.','4600000',14800.00],
    ['game','🎮','Game studio','Entertainment','Maak games voor spelers wereldwijd.','6200000',20300.00],
    ['biotech','🧬','Biotechbedrijf','Wetenschap','Onderzoek en ontwikkel nieuwe biotechnologie.','8500000',28100.00],
    ['airline','🛫','Luchtvaartmaatschappij','Transport','Vlieg passagiers en vracht naar bestemmingen.','11500000',38500.00],
    ['port','🚢','Containerterminal','Logistiek','Verwerk containers in een grote zeehaven.','15500000',53000.00],
    ['bank','🏦','Investeringsbank','Financiën','Financier bedrijven en grote projecten.','21000000',72500.00],
    ['media','📺','Mediabedrijf','Media','Televisie, nieuws en streamingdiensten.','28500000',99000.00],
    ['autos','🏎️','Autofabriek','Industrie','Bouw elektrische en sportieve auto’s.','38500000',136000.00],
    ['pharma','💊','Farmaceutisch concern','Wetenschap','Ontwikkel en produceer geneesmiddelen.','52000000',188000.00],
    ['space','🛰️','Ruimtevaartbedrijf','Wetenschap','Satellieten en ruimtevaarttechnologie.','70000000',258000.00],
    ['energy','⚡','Energieconcern','Energie','Beheer energiecentrales en infrastructuur.','95000000',355000.00],
    ['telecom','📡','Telecomprovider','Technologie','Mobiele netwerken en glasvezel.','130000000',495000.00],
    ['exchange','📈','Beursplatform','Financiën','Een groot digitaal handelsplatform.','180000000',690000.00],
    ['globalai','🦾','AI Research Corporation','Technologie','Train grote AI-modellen en bouw datacenters.','250000000',970000.00],
    ['conglomerate','🌐','Holland Global Group','Conglomeraat','Een internationaal concern met tientallen divisies.','350000000',1380000.00]
  ].map(([id,icon,name,category,description,cost,income]) => ({id,icon,name,category,description,cost:Number(cost),income:Number(income)}));

  const marketAssets = [
    {id:'tulip-token',icon:'🌷',name:'Tulpen-token',origin:'Bollenstreek',price:12.5},
    {id:'wind-token',icon:'🌬️',name:'Windmolen-token',origin:'Nederland',price:26},
    {id:'bike-token',icon:'🚲',name:'Fiets-token',origin:'Nederland',price:8.4},
    {id:'orange-token',icon:'🟠',name:'Oranje-shirt-token',origin:'Oranje sport',price:18},
    {id:'stroop-token',icon:'🧇',name:'Stroopwafel-token',origin:'Gouda',price:6.75},
    {id:'clogs-token',icon:'👞',name:'Klompen-token',origin:'Nederland',price:10.2},
    {id:'canal-token',icon:'🏘️',name:'Grachtenpand-token',origin:'Amsterdam',price:95},
    {id:'football-token',icon:'⚽',name:'Voetbal-token',origin:'Nederland',price:21},
    {id:'pompe-token',icon:'❤️',name:'Pompeblêd-token',origin:'Friesland',price:15.5},
    {id:'wors-token',icon:'🥖',name:'Worstenbrood-token',origin:'Noord-Brabant',price:9.25},
    {id:'skutsje-token',icon:'⛵',name:'Skûtsje-token',origin:'Friesland',price:32},
    {id:'brabant-token',icon:'🎡',name:'Bossche Kermis-token',origin:'Noord-Brabant',price:14.25}
  ];

  const rarities = {
    common:{label:'Common',className:'common',color:'#bac6d2',value:5},
    uncommon:{label:'Uncommon',className:'uncommon',color:'#91e6ad',value:25},
    rare:{label:'Rare',className:'rare',color:'#8fcbff',value:100},
    epic:{label:'Epic',className:'epic',color:'#d3a4ff',value:500},
    legendary:{label:'Legendary',className:'legendary',color:'#ffd67e',value:5000},
    mythic:{label:'Mythic',className:'mythic',value:50000}
  };
  const loot = [
    {id:'shopping-cart',name:'Winkelwagentje',icon:'🛒',rarity:'common',value:5},
    {id:'old-bike',name:'Tweedehands fiets',icon:'🚲',rarity:'common',value:8},
    {id:'traffic-cone',name:'Verkeerskegel',icon:'🚧',rarity:'common',value:10},
    {id:'garden-gnome',name:'TuinKabouter',icon:'🧑‍🌾',rarity:'common',value:14},
    {id:'fold-chair',name:'Klapstoel',icon:'🪑',rarity:'common',value:18},
    {id:'delivery-scooter',name:'Bezorgscooter',icon:'🛵',rarity:'uncommon',value:35},
    {id:'camper',name:'Oude camper',icon:'🚐',rarity:'uncommon',value:55},
    {id:'local-cup',name:'Amateurbeker',icon:'🏆',rarity:'uncommon',value:75},
    {id:'market-stall',name:'Marktkraam',icon:'🏪',rarity:'uncommon',value:90},
    {id:'canal-boat',name:'Grachtenboot',icon:'🛥️',rarity:'rare',value:160},
    {id:'mini-windmill',name:'Eigen windmolen',icon:'🌬️',rarity:'rare',value:240},
    {id:'skutsje',name:'Fries Skûtsje',icon:'⛵',rarity:'rare',value:320},
    {id:'sports-car',name:'Sportwagen',icon:'🏎️',rarity:'rare',value:450},
    {id:'canal-mansion',name:'Grachten herenhuis',icon:'🏛️',rarity:'epic',value:900},
    {id:'private-yacht',name:'Superjacht',icon:'🛳️',rarity:'epic',value:1600},
    {id:'stadium',name:'Eigen voetbalstadion',icon:'🏟️',rarity:'epic',value:2400},
    {id:'private-jet',name:'Privéjet',icon:'🛩️',rarity:'epic',value:4000},
    {id:'island-resort',name:'Tropisch privéresort',icon:'🏝️',rarity:'legendary',value:9000},
    {id:'supercar-fleet',name:'Supercarcollectie',icon:'🚘',rarity:'legendary',value:14000},
    {id:'ai-campus',name:'AI-campus',icon:'🏢',rarity:'legendary',value:22000},
    {id:'burj-khalifa',name:'Burj Khalifa',icon:'🏙️',rarity:'mythic',value:100000},
    {id:'private-island',name:'Privé-eiland',icon:'🌴',rarity:'mythic',value:135000},
    {id:'space-company',name:'Ruimtevaartconcern',icon:'🚀',rarity:'mythic',value:180000},
    {id:'mega-yacht',name:'Mega-superjacht',icon:'🚢',rarity:'mythic',value:250000}
  ];

  const crates = [
    {id:'street',name:'Straatvondst',icon:'📦',cost:25,desc:'Voor je eerste kleine vondst. Veel simpele spullen.',odds:{common:76,uncommon:20,rare:3.5,epic:.5}},
    {id:'business',name:'Ondernemerskist',icon:'🧰',cost:175,desc:'Meer kans op voertuigen en bijzondere bezittingen.',odds:{common:47,uncommon:34,rare:15,epic:3.5,legendary:.5}},
    {id:'luxury',name:'Luxe kluis',icon:'💼',cost:1200,desc:'Voor spelers die al een aardig imperium hebben.',odds:{common:18,uncommon:32,rare:30,epic:16,legendary:3.8,mythic:.2}},
    {id:'millionaire',name:'Miljonairscrate',icon:'💎',cost:12000,desc:'Veel kans op epische en legendarische bezittingen.',odds:{uncommon:8,rare:27,epic:42,legendary:20,mythic:3}},
    {id:'royal',name:'Koninklijke kluis',icon:'👑',cost:125000,desc:'De duurste kist. Alleen de grootste flexers wagen hun kans.',odds:{rare:8,epic:32,legendary:42,mythic:18}}
  ];

  const quizQuestions = [
    {q:'Welke stad is de hoofdstad van Nederland?',a:['Amsterdam','Rotterdam','Utrecht','Den Haag'],correct:0},
    {q:'Welke provincie hoort bij de Elfstedentocht?',a:['Zeeland','Friesland','Limburg','Drenthe'],correct:1},
    {q:'Welke sport speelt men op Wimbledon?',a:['Hockey','Voetbal','Tennis','Volleybal'],correct:2},
    {q:'In welke stad staat de Domtoren?',a:['Utrecht','Leiden','Breda','Groningen'],correct:0},
    {q:'Wat is een typisch Brabants broodje?',a:['Kaiserbroodje','Worstenbroodje','Pitabroodje','Bagel'],correct:1},
    {q:'Welke kleur hoort bij het Nederlandse koningshuis?',a:['Paars','Groen','Oranje','Geel'],correct:2},
    {q:'Welke Nederlandse stad heeft een grote zeehaven?',a:['Rotterdam','Arnhem','Zwolle','Amersfoort'],correct:0},
    {q:'Hoe heet de bekende Friese zeilboot?',a:['Skûtsje','Gondel','Vlet','Punter'],correct:0},
    {q:'Welke provincie staat bekend om de bollenvelden bij Lisse?',a:['Zuid-Holland','Noord-Holland','Gelderland','Overijssel'],correct:0},
    {q:'Welke sportclub speelt in Eindhoven?',a:['PSV','AZ','FC Twente','SC Heerenveen'],correct:0},
    {q:'Welke rivier stroomt door Maastricht?',a:['IJssel','Maas','Waal','Vecht'],correct:1},
    {q:'Wat is de bijnaam van de Nederlandse nationale voetbalploeg?',a:['De Rode Duivels','Die Mannschaft','Oranje','La Roja'],correct:2}
  ];

  window.HollandCatalog = {games,companies,marketAssets,rarities,loot,crates,quizQuestions};
})();
