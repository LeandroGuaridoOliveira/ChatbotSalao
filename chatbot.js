const qrcode = require('qrcode-terminal');
const { Client, LocalAuth } = require('whatsapp-web.js'); // ✅ LocalAuth adicionado
const sqlite3 = require('sqlite3');
const { open } = require('sqlite');

// ✅ Cria o client com autenticação persistente
const client = new Client({
  authStrategy: new LocalAuth(),
  puppeteer: { headless: true } // coloque false se quiser ver o navegador
});

// ✅ Mostra o QR Code no terminal
client.on('qr', qr => {
  console.log('📱 Escaneie o QR code para logar no WhatsApp:');
  qrcode.generate(qr, { small: true });
});

// ✅ Informa quando o bot estiver pronto
client.on('ready', () => {
  console.log('✅ Bot do WhatsApp está pronto!');
});

// ✅ Exemplo de resposta a mensagem
client.on('message', async msg => {
  if (msg.body.toLowerCase() === 'oi') {
    await msg.reply('Olá! Como posso te ajudar?');
  }
});

// ✅ Inicializa o bot
client.initialize();

// ✅ Função de conexão com o banco com retry
async function abrirBancoComRetry(tentativas = 10, delayMs = 200) {
  for (let i = 0; i < tentativas; i++) {
    try {
      const db = await open({
        filename: './banco.db',
        driver: sqlite3.Database
      });
      return db;
    } catch (err) {
      if (err.code === 'SQLITE_BUSY') {
        await new Promise(res => setTimeout(res, delayMs));
      } else {
        throw err;
      }
    }
  }
  throw new Error('Não foi possível abrir o banco de dados (SQLITE_BUSY).');
}

client.on('qr', qr => {
    qrcode.generate(qr, { small: true });
});
client.on('ready', () => {
    console.log('Tudo certo! WhatsApp conectado.');
});
client.initialize();

const sessions = new Map();
const INACTIVITY_THRESHOLD = 5 * 60 * 1000;

const finalizarSessao = async (chat, client, to, mensagem) => {
    await sendMessageWithTyping(chat, client, to, mensagem, 0, 0);
    sessions.delete(to);
};
const resetarTimerInatividade = (chat, client, to) => {
    if (sessions.has(to) && sessions.get(to).timer) {
        clearTimeout(sessions.get(to).timer);
    }
    const timer = setTimeout(() =>
        finalizarSessao(chat, client, to, "O atendimento foi encerrado por inatividade. Caso deseje agendar novamente, basta enviar uma mensagem. Até breve!"),
        INACTIVITY_THRESHOLD
    );
    if (!sessions.has(to)) sessions.set(to, {});
    sessions.get(to).timer = timer;
};

client.on('message', async msg => {
    const chat = await msg.getChat();
    const to = msg.from;

    if (msg.body.toLowerCase() === 'listar agendamentos') {
        const ags = await listarAgendamentosCompletos();
        let texto = "📋 *Agendamentos salvos:*\n";
        if (ags.length === 0) texto += "_Nenhum agendamento cadastrado._";
        ags.forEach(ag => {
            texto += `\n📌 ID: ${ag.agendamento_id}\n👤 Nome: ${ag.cliente_nome}\n🆔 CPF: ${ag.cliente_cpf}\n📅 Dia: ${ag.dia} às ${ag.horario}\n💇 Procedimentos: ${ag.nomes_procedimentos}\n💰 Total: R$ ${ag.valor_total.toFixed(2)}\n`;

        });
        await msg.reply(texto);
        return;
    }

    if (!sessions.has(to)) {
        sessions.set(to, { etapa: 1, dados: {}, timer: null });
        await sendMessageWithTyping(chat, client, to, "Olá! Para agendar, por favor informe seu nome completo.\nExemplo: *Maria da Silva*");
        return;
      }
      
      if (msg.body.toLowerCase() === 'agendar') {
        sessions.set(to, { etapa: 1, dados: {}, timer: null });
        await sendMessageWithTyping(chat, client, to, "Vamos começar um novo agendamento!\nInforme seu nome completo.");
        return;
      }
      

    let sessao = sessions.get(to);
    resetarTimerInatividade(chat, client, to);

                switch(sessao.etapa) {
                    case 1:
                        sessao.dados.nome = msg.body.trim();
                        sessao.etapa = 2;
                        await sendMessageWithTyping(
                            chat, client, to,
                            "Agora, informe seu CPF.\nExemplo: *123.456.789-00*"
                        );
                        break;
                        function formatarCPF(cpf) {
                            return cpf.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, "$1.$2.$3-$4");
                        }
                        
                        // ... dentro do client.on('message', async msg => {...})
            
                    case 2:
                        let cpfLimpo = msg.body.replace(/\D/g, '');
                        if (cpfLimpo.length !== 11) {
                            await sendMessageWithTyping(
                                chat, client, to,
                                "❌ CPF inválido! Certifique-se de digitar 11 números. Tente novamente.\nExemplo: *12345678900* ou *123.456.789-00*"
                            );
                            return;
                        }
                        sessao.dados.cpf = cpfLimpo; // salva limpo
                        sessao.etapa = 3;
                        await sendMessageWithTyping(
                            chat, client, to,
                            "Qual é a *data* do atendimento?\nExemplo: *25/04/2025*"
                        );
                        break;
                        case 3:
                            const dataInput = msg.body.trim();
                            const regexData = /^\d{2}\/\d{2}\/\d{4}$/;
                        
                            if (!regexData.test(dataInput)) {
                                await sendMessageWithTyping(chat, client, to, "❌ Data inválida! Use o formato *DD/MM/AAAA*.\nExemplo: *25/04/2025*");
                                return;
                            }
                        
                            const [dia, mes, ano] = dataInput.split('/').map(Number);
                            const dataAgendamento = new Date(ano, mes - 1, dia);
                            const hoje = new Date();
                            hoje.setHours(0, 0, 0, 0); // Zera horário
                        
                            if (isNaN(dataAgendamento.getTime()) || dataAgendamento < hoje) {
                                await sendMessageWithTyping(chat, client, to, "❌ A data precisa ser válida e a partir de hoje.");
                                return;
                            }
                        
                            sessao.dados.dia = dataInput;
                            sessao.etapa = 4;
                            await sendMessageWithTyping(
                                chat, client, to,
                                "Qual o horário desejado?\nEstamos abertos das *08:00* às *18:00*.\nExemplo: *14:00*"
                            );
                            break;
                        
                            case 4:
                                const horario = msg.body.trim();
                                const regexHora = /^([01]\d|2[0-3]):([0-5]\d)$/;
                            
                                if (!regexHora.test(horario)) {
                                    await sendMessageWithTyping(chat, client, to, "❌ Horário inválido! Use o formato *HH:MM* (24h).\nExemplo: *14:30*");
                                    return;
                                }
                            
                                const [hh, mm] = horario.split(':').map(Number);
                                const horaNum = hh + mm / 60;
                            
                                if (horaNum < 8 || horaNum > 18) {
                                    await sendMessageWithTyping(chat, client, to, "⏰ Horário fora do funcionamento! Escolha entre *08:00* e *18:00*.");
                                    return;
                                }
                            
                                sessao.dados.horario = horario;
                                sessao.etapa = 5;
                                sessao.procedimentosMenu = await listarProcedimentos();
                            
                                let menu = "Escolha o procedimento digitando o número correspondente:\n";
                                sessao.procedimentosMenu.forEach((p, idx) => {
                                    menu += `${idx + 1} - ${p.nome} (R$ ${p.valor.toFixed(2)})\n`;
                                });
                                menu += "\nDigite o número do procedimento ou *0* para finalizar.";
                                await sendMessageWithTyping(chat, client, to, menu);
                                break;
                            
                case 5:
                    const input = msg.body.trim();
                    const lista = sessao.procedimentosMenu;
                    const idx = parseInt(input, 10) - 1;
        
                    // Caso digite 0 — finalizar escolha de procedimentos
                    if (input === '0') {
                        if (!sessao.dados.procedimentos || sessao.dados.procedimentos.length === 0) {
                            await sendMessageWithTyping(chat, client, to, "❗ Você precisa escolher pelo menos 1 procedimento antes de finalizar.");
                            return;
                        }
        
                        const cliente = await inserirOuObterCliente(sessao.dados.nome, sessao.dados.cpf);
                        const db = await abrirBancoComRetry();
        
                        await db.run(`INSERT INTO agendamentos (cliente_id, dia, horario) VALUES (?, ?, ?)`, [cliente.id, sessao.dados.dia, sessao.dados.horario]);
                        const agendamento = await db.get(`SELECT last_insert_rowid() as id`);
        
                        for (const proc of sessao.dados.procedimentos) {
                            await db.run(`INSERT INTO agendamento_procedimentos (agendamento_id, procedimento_id) VALUES (?, ?)`, [agendamento.id, proc.id]);
                        }
        
                        await db.close();
        
                        let total = 0;
                        let listaTexto = sessao.dados.procedimentos.map(p => {
                            total += p.valor;
                            return `• ${p.nome} (R$ ${p.valor.toFixed(2)})`;
                        }).join('\n');
        
                        const tempoEstimado = sessao.dados.procedimentos.length * 30;
        
                        await sendMessageWithTyping(chat, client, to,
                        `✅ *Seu agendamento está confirmado!*\n
        👤 *Nome:* ${cliente.nome}
        🆔 *CPF:* ${formatarCPF(cliente.cpf)}
        📅 *Dia:* ${sessao.dados.dia}
        ⏰ *Horário:* ${sessao.dados.horario}
        
        💇‍♀️ *Procedimentos:*\n${listaTexto}
        💰 *Total:* R$ ${total.toFixed(2)}
        🕒 *Tempo estimado:* ${tempoEstimado} minutos
        
        *Obrigado por agendar conosco! Até breve!*`);
        
                        if (sessao.timer) clearTimeout(sessao.timer);
                        sessions.delete(to);
                        break;
                    }
        
                    // Validação normal do procedimento
                    if (!lista || isNaN(idx) || idx < 0 || idx >= lista.length) {
                        await sendMessageWithTyping(
                            chat, client, to,
                            "❌ Por favor, digite o *número do procedimento* conforme o menu acima.\nExemplo: *1*"
                        );
                        return;
                    }
        
                    const escolhido = lista[idx];
                    if (!sessao.dados.procedimentos) sessao.dados.procedimentos = [];
                    if (sessao.dados.procedimentos.some(p => p.id === escolhido.id)) {
                        await sendMessageWithTyping(chat, client, to, "⚠️ Esse procedimento já foi adicionado. Escolha outro ou digite *0* para finalizar.");
                        return;
                    }
        
                    sessao.dados.procedimentos.push(escolhido);
        
                    let menuNovo = "✅ Procedimento adicionado!\n\nDeseja adicionar mais?\n";
                    lista.forEach((p, i) => {
                        menuNovo += `${i + 1} - ${p.nome} (R$ ${p.valor.toFixed(2)})\n`;
                    });
                    menuNovo += "\nDigite o número do procedimento ou *0* para continuar.";
                    await sendMessageWithTyping(chat, client, to, menuNovo);
                    break;
    
    
    }
});
