const qrcode = require('qrcode-terminal');
const { Client } = require('whatsapp-web.js');
const sqlite3 = require('sqlite3');
const { open } = require('sqlite');

// Função de abrir banco com retry automático
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

// Criação das tabelas
async function inicializarTabelas() {
    const db = await abrirBancoComRetry();
    await db.run(`
        CREATE TABLE IF NOT EXISTS clientes (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            nome TEXT,
            cpf TEXT UNIQUE
        );
    `);
    await db.run(`
        CREATE TABLE IF NOT EXISTS procedimentos (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            nome TEXT,
            valor REAL
        );
    `);
    await db.run(`
        CREATE TABLE IF NOT EXISTS agendamentos (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            cliente_id INTEGER,
            procedimento_id INTEGER,
            dia TEXT,
            horario TEXT,
            FOREIGN KEY (cliente_id) REFERENCES clientes(id),
            FOREIGN KEY (procedimento_id) REFERENCES procedimentos(id)
        );
    `);
    await db.close();
}

async function inserirProcedimentosIniciais() {
    const db = await abrirBancoComRetry();
    const procedimentos = [
        { nome: "Corte Feminino", valor: 60 },
        { nome: "Corte Masculino", valor: 40 },
        { nome: "Escova", valor: 50 },
        { nome: "Manicure", valor: 30 },
        { nome: "Pedicure", valor: 35 }
    ];
    const row = await db.get('SELECT COUNT(*) as total FROM procedimentos');
    if (row.total === 0) {
        for (const p of procedimentos) {
            await db.run('INSERT INTO procedimentos (nome, valor) VALUES (?, ?)', [p.nome, p.valor]);
        }
    }
    await db.close();
}

async function listarProcedimentos() {
    const db = await abrirBancoComRetry();
    const procedimentos = await db.all('SELECT * FROM procedimentos');
    await db.close();
    return procedimentos;
}

async function inserirOuObterCliente(nome, cpf) {
    const db = await abrirBancoComRetry();
    let cliente = await db.get('SELECT * FROM clientes WHERE cpf = ?', [cpf]);
    if (!cliente) {
        await db.run('INSERT INTO clientes (nome, cpf) VALUES (?, ?)', [nome, cpf]);
        cliente = await db.get('SELECT * FROM clientes WHERE cpf = ?', [cpf]);
    }
    await db.close();
    return cliente;
}

async function inserirAgendamento(cliente_id, procedimento_id, dia, horario) {
    const db = await abrirBancoComRetry();
    await db.run(
        `INSERT INTO agendamentos (cliente_id, procedimento_id, dia, horario) VALUES (?, ?, ?, ?)`,
        [cliente_id, procedimento_id, dia, horario]
    );
    await db.close();
}

async function buscarProcedimentoPorId(id) {
    const db = await abrirBancoComRetry();
    const procedimento = await db.get('SELECT * FROM procedimentos WHERE id = ?', [id]);
    await db.close();
    return procedimento;
}

async function listarAgendamentosCompletos() {
    const db = await abrirBancoComRetry();
    const agendamentos = await db.all(`
        SELECT 
            a.id, c.nome, c.cpf, a.dia, a.horario, 
            p.nome AS procedimento, p.valor
        FROM agendamentos a
        LEFT JOIN clientes c ON c.id = a.cliente_id
        LEFT JOIN procedimentos p ON p.id = a.procedimento_id
        ORDER BY a.id DESC
    `);
    await db.close();
    return agendamentos;
}

(async () => {
    await inicializarTabelas();
    await inserirProcedimentosIniciais();
})();

const client = new Client();
const delay = ms => new Promise(res => setTimeout(res, ms));

const sendMessageWithTyping = async (chat, client, to, message, typingDelay = 1500, messageDelay = 500) => {
    await delay(typingDelay);
    await chat.sendStateTyping();
    await delay(messageDelay);
    await client.sendMessage(to, message);
};

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

    // Listar agendamentos (admin)
    if (msg.body.toLowerCase() === 'listar agendamentos') {
        const ags = await listarAgendamentosCompletos();
        let texto = "📋 *Agendamentos salvos:*\n";
        if (ags.length === 0) texto += "_Nenhum agendamento cadastrado._";
        ags.forEach(ag => {
            texto += `\nID: ${ag.id}\nNome: ${ag.nome} | CPF: ${ag.cpf}\nDia: ${ag.dia} às ${ag.horario}\nProcedimento: ${ag.procedimento} (R$ ${ag.valor})\n`;
        });
        await msg.reply(texto);
        return;
    }

    // Nova sessão
    if (!sessions.has(to) || msg.body.toLowerCase() === 'agendar' || msg.body === '0') {
        sessions.set(to, { etapa: 1, dados: {}, timer: null });
        await sendMessageWithTyping(
            chat, client, to,
            "Olá! Para agendar, por favor informe seu nome completo.\nExemplo: *Maria da Silva*"
        );
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
        case 2:
            sessao.dados.cpf = msg.body.trim();
            sessao.etapa = 3;
            await sendMessageWithTyping(
                chat, client, to,
                "Qual é a *data* do atendimento do atendimento?\nExemplo: *25/04/2025*"
            );
            break;
        case 3:
            sessao.dados.dia = msg.body.trim();
            sessao.etapa = 4;
            await sendMessageWithTyping(
                chat, client, to,
                "Qual o horário desejado?\nExemplo: *14:00*"
            );
            break;
        case 4:
            sessao.dados.horario = msg.body.trim();
            sessao.etapa = 5;
            sessao.procedimentosMenu = await listarProcedimentos();
            let menu = "Escolha o procedimento digitando o número correspondente:\n";
            sessao.procedimentosMenu.forEach((p, idx) => {
                menu += `${idx+1} - ${p.nome} (R$ ${p.valor.toFixed(2)})\n`;
            });
            menu += "\nExemplo: *2*";
            await sendMessageWithTyping(chat, client, to, menu);
            break;
        case 5:
            const idx = parseInt(msg.body.trim(), 10) - 1;
            const lista = sessao.procedimentosMenu;
            if (!lista || isNaN(idx) || idx < 0 || idx >= lista.length) {
                await sendMessageWithTyping(
                  chat, client, to,
                  "Por favor, digite o *número* do procedimento conforme o menu acima.\nExemplo: *1*"
                );
                return;
            }
            const procedimentoEscolhido = lista[idx];
            const cliente = await inserirOuObterCliente(sessao.dados.nome, sessao.dados.cpf);
            await inserirAgendamento(cliente.id, procedimentoEscolhido.id, sessao.dados.dia, sessao.dados.horario);
            await sendMessageWithTyping(
                chat, client, to,
                `✅ *Seu agendamento está confirmado!*\n
👤 *Nome:* ${cliente.nome}
🆔 *CPF:* ${cliente.cpf}
📅 *Dia:* ${sessao.dados.dia}
⏰ *Horário:* ${sessao.dados.horario}
💇‍♀️ *Procedimento:* ${procedimentoEscolhido.nome}
💵 *Valor:* R$ ${procedimentoEscolhido.valor.toFixed(2)}

*Obrigado por agendar conosco!*`
            );
            sessions.delete(to);
            break;
        default:
            await sendMessageWithTyping(chat, client, to, "Desculpe, não entendi. Digite *agendar* para iniciar um novo agendamento.");
            sessions.delete(to);
            break;
    }
});