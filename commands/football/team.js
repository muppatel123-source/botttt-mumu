const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, ComponentType } = require('discord.js');
const axios = require('axios');

module.exports = {
    name: 'team',
    aliases: ['squad', 'club', 'teaminfo'],
    category: 'utilities',
    description: 'Get detailed info and a creative squad roster for a football club.',
    usage: '<team name>',
    examples: ['.team Real Madrid', '.squad RMA', '.club Barca'],
    async execute(message, args) {
        if (!args.length) {
            const helpCmd = message.client.commands.get('help');
            return helpCmd.execute(message, [this.name]);
        }

        const headers = { 'X-Auth-Token': process.env.FOOTBALL_API_KEY };
        const query = args.join(' ').toLowerCase();

        const idMap = {
            'arsenal': 57, 'aston villa': 58, 'bournemouth': 1044, 'brentford': 402, 
            'brighton': 78, 'chelsea': 61, 'crystal palace': 354, 'everton': 62, 
            'fulham': 63, 'ipswich': 349, 'leicester': 338, 'liverpool': 64, 
            'manchester city' : 65, 'city' : 65, 'mancity': 65, 'utd': 66, 'united' : 66, 'manchester' : 66, 'manchester united' : 66, 'newcastle': 67, 'nottingham': 351, 
            'southampton': 340, 'spurs': 73, 'tottenham' : 73, 'westham': 68, 'wolves': 76,

              'alaves': 263, 'athletic': 77, 'atleti': 78, 'atletico' : 78, 'atletico madrid' : 78, 'atm' : 78, 'barca': 81, 'barcelona' : 81, 'FC barcelona' : 81, 
              'betis': 90, 'celta': 80, 'celta vigo' : 80, 'getafe': 82, 'girona': 298, 
              'las palmas': 275, 'leganes': 745, 'mallorca': 89, 'osasuna': 79, 
              'vallecano': 87, 'rayo vallecano' : 87, 'madrid' : 86, 'rma' : 86, 'real madrid': 86, 'real sociedad': 92, 'sevilla': 559, 
              'valencia': 95, 'valladolid': 250, 'villarreal': 94, 'espanyol': 88,

            'augsburg': 16, 'bayer leverkusen' : 721, 'leverkusen': 721, 'bayern': 5, 'bayern munich' : 5, 'bochum': 36, 
            'dortmund': 4, 'frankfurt': 19, 'freiburg': 17, 'heidenheim': 44, 
          'hoffenheim': 2, 'holstein kiel': 720, 'leipzig': 503, 'mainz': 15, 
          'gladbach': 18, 'pauli': 33, 'stuttgart': 10, 'union berlin': 28, 
            'werder bremen': 12, 'wolfsburg': 11,

            'atalanta': 102, 'bologna': 103, 'cagliari': 104, 'como': 105, 
            'empoli': 445, 'fiorentina': 108, 'genoa': 110, 'verona': 450, 
            'inter': 108, 'inter milan' : 108, 'juventus': 109, 'juve': 109, 'lazio': 110, 'lecce': 5890, 
            'milan': 98, 'ac milan' : 98, 'monza': 5911, 'napoli': 113, 'parma': 112, 
            'roma': 100, 'torino': 586, 'udinese': 115, 'venezia': 455,

            'angers': 532, 'auxerre': 519, 'brest': 512, 'le havre': 533, 
            'lens': 548, 'lille': 527, 'lyon': 523, 'marseille': 516, 
            'monaco': 548, 'montpellier': 518, 'nantes': 543, 'nice': 521, 
              'paris saint german' : 524, 'psg': 524, 'reims': 547, 'rennes': 529, 'saint-etienne': 527, 
            'strasbourg': 519, 'toulouse': 511,

          'argentina': 762, 'brazil': 764, 'france': 770, 'germany': 759, 
          'spain': 760, 'es' : 760, 'england': 773, 'portugal': 765, 'italy': 784, 
            'netherlands': 761, 'belgium': 805, 'croatia': 799, 'uruguay': 783, 
            'mexico': 769, 'usa': 768, 'united states' : 768, 'morocco': 802, 'japan': 778
        };

        const teamId = idMap[query];

        try {
            let team;
            if (teamId) {
                const res = await axios.get(`https://api.football-data.org/v4/teams/${teamId}`, { headers });
                team = res.data;
            } else {
                const searchRes = await axios.get(`https://api.football-data.org/v4/teams?name=${encodeURIComponent(args.join(' '))}`, { headers });
                team = searchRes.data.teams?.find(t => t.name.toLowerCase().includes(query) || t.shortName?.toLowerCase().includes(query));
            }

            if (!team || (team.id === 1 && !query.includes('koln'))) {
                return message.reply("<a:error:1486745155775234309> Team not found.");
            }

            let footerText = `Founded: ${team.founded || 'Unknown'}`;
            let embedColor = 0xFEBE10;
            if (team.id === 86) { footerText = "¡Hala Madrid y nada más! ⚪"; embedColor = 0xFFFFFF; }
            if (team.id === 81) { footerText = "Visca el Barça! 🔵🔴"; embedColor = 0xA70042; }
            if (team.id === 64) { footerText = "You'll Never Walk Alone 🔴"; embedColor = 0xC8102E; }  
            if (team.id === 66) { footerText = "Glory Glory Man United 🔴"; embedColor = 0xDA020E; }
            if (team.id === 65) { footerText = "City Till I Die 🔵"; embedColor = 0x6CABDD; }
          if (team.id === 57) { footerText = "Victoria Concordia Crescit 🔴"; embedColor = 0xEF0107; }
          if (team.id === 61) { footerText = "Keep The Blue Flag Flying High 🔵"; embedColor = 0x034694; }
          if (team.id === 73) { footerText = "Audere est Facere ⚪"; embedColor = 0x132257; }
          if (team.id === 5) { footerText = "Mia San Mia 🔴⚪"; embedColor = 0xDC052D; }
          if (team.id === 4) { footerText = "Echte Liebe 🟡⚫"; embedColor = 0xFDE100; }
          if (team.id === 721) { footerText = "Werkself 🔴⚫"; embedColor = 0xE32221; }
          if (team.id === 98) { footerText = "Sempre Milan 🔴⚫"; embedColor = 0xFB090B; }
          if (team.id === 108) { footerText = "C'è solo l'Inter ⚫🔵"; embedColor = 0x0066B2; }
          if (team.id === 109) { footerText = "Fino Alla Fine ⚪⚫"; embedColor = 0x000000; }
          if (team.id === 100) { footerText = "Giallorossi 💛❤️"; embedColor = 0x8E1F2F; }
          if (team.id === 524) { footerText = "Ici c'est Paris 🔵🔴"; embedColor = 0x004170; }
          if (team.id === 78) { footerText = "Nunca dejes de creer 🔴⚪"; embedColor = 0xCB3524; }

          if (team.id === 762) { footerText = "¡Muchachos, ahora nos volvimos a ilusionar! 🇦🇷"; embedColor = 0x75AADB; }
          if (team.id === 764) { footerText = "Ordem e Progresso 🇧🇷"; embedColor = 0xFFDF00; }
          if (team.id === 770) { footerText = "Allez Les Bleus! 🇫🇷"; embedColor = 0x002395; }
          if (team.id === 765) { footerText = "Força Portugal! 🇵🇹"; embedColor = 0xE42518; }
          if (team.id === 759) { footerText = "Die Mannschaft 🇩🇪"; embedColor = 0x000000; }
          if (team.id === 760) { footerText = "¡Vamos España! 🇪🇸"; embedColor = 0xAA151B; }
          if (team.id === 773) { footerText = "It's Coming Home! 🏴󠁧󠁢󠁥󠁮󠁧󠁿"; embedColor = 0xFFFFFF; }
          if (team.id === 784) { footerText = "Forza Azzurri! 🇮🇹"; embedColor = 0x004BB3; }
          if (team.id === 761) { footerText = "Hup Holland Hup! 🇳🇱"; embedColor = 0xF36C21; }
          if (team.id === 805) { footerText = "Tous Ensemble! 🇧🇪"; embedColor = 0xE10600; }
          if (team.id === 799) { footerText = "Obitelj! 🇭🇷"; embedColor = 0xED1C24; }
          if (team.id === 802) { footerText = "Dima Maghrib! 🇲🇦"; embedColor = 0x117139; }
          if (team.id === 778) { footerText = "Samurai Blue! 🇯🇵"; embedColor = 0x00008B; }
            

            const infoEmbed = new EmbedBuilder()
                .setColor(embedColor)
                .setTitle(`<:Info:1486732443888259154> ${team.name} (${team.tla || 'N/A'})`)
                .setThumbnail(team.crest)
                .addFields(
                    { name: '🏟️ Venue', value: team.venue || 'N/A', inline: true },
                    { name: '👔 Coach', value: team.coach?.name || 'N/A', inline: true },
                    { name: '🌐 Website', value: team.website || 'N/A', inline: false },
                    { name: '🏆 Top Competition', value: team.runningCompetitions?.[0]?.name || 'N/A', inline: true }
                )
                .setFooter({ text: footerText });

            const row = new ActionRowBuilder().addComponents(
                new ButtonBuilder().setCustomId('view-squad').setLabel('Full Squad Roster').setStyle(ButtonStyle.Primary).setEmoji('🏃')
            );

            const msg = await message.reply({ embeds: [infoEmbed], components: [row] });

            const collector = msg.createMessageComponentCollector({ componentType: ComponentType.Button, time: 60000 });

            collector.on('collect', async i => {
                if (i.user.id !== message.author.id) return i.reply({ content: 'Not yours!', ephemeral: true });
                
                const squad = team.squad || [];
                
                // --- 🛠️ THE "STRIKER PROTECTOR" POSITION MAPPING ---
                const getPos = (player) => {
                    const pos = (player.position || '').toUpperCase();
                    
                    // Priority 1: Strikers/Attackers
                    if (pos.includes('OFFENCE') || pos.includes('FORWARD') || pos.includes('STRIKER') || pos.includes('WING')) return 'FW';
                    // Priority 2: Midfielders (Including CDMs)
                    if (pos.includes('MID')) return 'MF';
                    // Priority 3: Defenders
                    if (pos.includes('DEF') || pos.includes('BACK')) return 'DF';
                    // Priority 4: Goalies
                    if (pos.includes('GOAL') || pos.includes('GK')) return 'GK';
                    
                    return '??';
                };

                const sortedSquad = squad.sort((a, b) => {
                    const order = { 'GK': 1, 'DF': 2, 'MF': 3, 'FW': 4, '??': 5 };
                    return order[getPos(a)] - order[getPos(b)];
                });

                const midPoint = Math.ceil(sortedSquad.length / 2);
                const leftSide = sortedSquad.slice(0, midPoint).map(p => `▫️ **${p.name}** \`(${getPos(p)})\``).join('\n');
                const rightSide = sortedSquad.slice(midPoint).map(p => `▫️ **${p.name}** \`(${getPos(p)})\``).join('\n');

                const squadEmbed = new EmbedBuilder()
                    .setColor(embedColor)
                    .setTitle(`🏃 ${team.name} - Official Squad List`)
                    .setThumbnail(team.crest)
                    .addFields(
                        { name: '\u200b', value: leftSide || 'N/A', inline: true },
                        { name: '\u200b', value: rightSide || 'N/A', inline: true }
                    )
                    .setFooter({ text: `GK: Goalkeeper | DF: Defence | MF: Midfield | FW: Forward | ${footerText}` });

                await i.update({ embeds: [squadEmbed], components: [] });
            });

        } catch (error) {
            console.error(error);
            message.reply("<a:error:1486745155775234309> API Error. Please try again.");
        }
    },
};