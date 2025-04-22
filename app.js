const express = require('express');
const session = require('express-session');
const bcrypt = require('bcrypt');
const sqlite3 = require('sqlite3');
const { open } = require('sqlite');
const path = require('path');

const app = express();
const PORT = 3000;

app.use(express.urlencoded({ extended: false }));
app.use(session({
    secret: 'secretoSalao',
    resave: false,
    saveUninitialized: false
}));
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

async function abrirBanco() {
    return open({
        filename: './banco.db',
        driver: sqlite3.Database
    });
}

async function inicializarUsuarios() {
    const db = await abrirBanco();
    await db.run(`
        CREATE TABLE IF NOT EXISTS usuarios (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            login TEXT UNIQUE,
            senhaHash TEXT
        );
    `);
    const usuario = await db.get('SELECT * FROM usuarios WHERE login = ?', ['admin']);
    if (!usuario) {
        const hash = bcrypt.hashSync('admin123', 10);
        await db.run('INSERT INTO usuarios (login, senhaHash) VALUES (?, ?)', ['admin', hash]);
    }
    await db.close();
}

async function inicializarTabelas() {
    const db = await abrirBanco();
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
    const db = await abrirBanco();
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

(async () => {
    await inicializarUsuarios();
    await inicializarTabelas();
    await inserirProcedimentosIniciais();
})();

function requireLogin(req, res, next) {
    if (req.session && req.session.usuarioLogado) return next();
    res.redirect('/login');
}

app.get('/login', (req, res) => {
    res.render('login', { erro: null });
});

app.post('/login', async (req, res) => {
    const { login, senha } = req.body;
    const db = await abrirBanco();
    const usuario = await db.get('SELECT * FROM usuarios WHERE login = ?', [login]);
    await db.close();
    if (usuario && bcrypt.compareSync(senha, usuario.senhaHash)) {
        req.session.usuarioLogado = usuario.login;
        return res.redirect('/agendamentos');
    } else {
        return res.render('login', { erro: 'Usuário ou senha inválidos.' });
    }
});

app.get('/logout', (req, res) => {
    req.session.destroy(() => res.redirect('/login'));
});

app.get('/alterar-senha', requireLogin, (req, res) => {
    res.render('alterarSenha', { msg: null });
});

app.post('/alterar-senha', requireLogin, async (req,res) => {
    const { senhaAtual, novaSenha, confirmarSenha } = req.body;
    const usuario = req.session.usuarioLogado;
    const db = await abrirBanco();
    const usuarioDb = await db.get('SELECT * FROM usuarios WHERE login = ?', [usuario]);
    if (!usuarioDb || !bcrypt.compareSync(senhaAtual, usuarioDb.senhaHash)) {
        await db.close();
        return res.render('alterarSenha', { msg: {tipo:'erro', texto:'Senha atual incorreta!'} });
    }
    if (novaSenha.length < 5) {
        await db.close();
        return res.render('alterarSenha', { msg: {tipo:'erro', texto:'A nova senha deve ter pelo menos 5 caracteres.'} });
    }
    if (novaSenha !== confirmarSenha) {
        await db.close();
        return res.render('alterarSenha', { msg: {tipo:'erro', texto:'Confirmação da senha não confere.'} });
    }
    const novaHash = bcrypt.hashSync(novaSenha, 10);
    await db.run('UPDATE usuarios SET senhaHash = ? WHERE login = ?', [novaHash, usuario]);
    await db.close();
    return res.render('alterarSenha', { msg: {tipo:'sucesso', texto:'Senha alterada com sucesso!'} });
});

app.get('/agendamentos', async (req, res) => {
    let { filtro, valorTexto, valorProcedimento, valorData } = req.query;
    let sql = `SELECT a.*, c.nome AS cliente_nome, c.cpf AS cliente_cpf, p.nome AS procedimento, p.valor
               FROM agendamentos a
               JOIN clientes c ON a.cliente_id = c.id  -- Incluindo a tabela clientes
               JOIN procedimentos p ON a.procedimento_id = p.id`;  // Mantendo a junção com procedimentos
    let params = [];

    if (filtro) {
        if (filtro === 'nome') {
            sql += ' WHERE c.nome LIKE ?';  // Alteração aqui: agora está filtrando pelo nome do cliente
            params.push(`%${valorTexto}%`);
        } else if (filtro === 'cpf') {
            sql += ' WHERE c.cpf LIKE ?';  // Alteração aqui: agora está filtrando pelo CPF do cliente
            params.push(`%${valorTexto}%`);
        } else if (filtro === 'procedimento') {
            sql += ' WHERE a.procedimento_id = ?';
            params.push(valorProcedimento);
        } else if (filtro === 'dia') {
            sql += ' WHERE a.dia = ?';
            params.push(valorData);
        }
    }

    try {
        const db = await abrirBanco();
        const ags = await db.all(sql, params);  // Agora a consulta retorna os dados do cliente também
        const listaProcedimentos = await db.all('SELECT * FROM procedimentos');
        await db.close();
        res.render('agendamentos', {
            ags,
            listaProcedimentos,
            filtro,
            valor: filtro === 'nome' || filtro === 'cpf' ? valorTexto
                 : filtro === 'procedimento' ? valorProcedimento
                 : filtro === 'dia' ? valorData
                 : ''
        });
    } catch (err) {
        res.send('Erro ao buscar agendamentos: ' + err.message);
    }
});



app.get('/novo-agendamento', requireLogin, async (req, res) => {
    const db = await abrirBanco();
    const procedimentos = await db.all('SELECT * FROM procedimentos');
    await db.close();
    res.render('novoAgendamento', {procedimentos, msg:null});
});

app.post('/novo-agendamento', requireLogin, async (req,res)=>{
    const {nome, cpf, dia, horario, procedimento_id} = req.body;
    const db = await abrirBanco();
    let cliente = await db.get('SELECT * FROM clientes WHERE cpf = ?', [cpf]);
    if(!cliente) {
        await db.run('INSERT INTO clientes (nome, cpf) VALUES (?, ?)', [nome, cpf]);
        cliente = await db.get('SELECT * FROM clientes WHERE cpf = ?', [cpf]);
    }
    await db.run('INSERT INTO agendamentos (cliente_id, procedimento_id, dia, horario) VALUES (?, ?, ?, ?)',
        [cliente.id, procedimento_id, dia, horario]);
    await db.close();
    res.redirect('/agendamentos');
});

app.post('/apagar-agendamento/:id', requireLogin, async (req, res) => {
    const db = await abrirBanco();
    await db.run('DELETE FROM agendamentos WHERE id = ?', [req.params.id]);
    await db.close();
    res.redirect('/agendamentos');
});

app.get('/', (req,res) => res.redirect('/agendamentos'));

app.listen(PORT, () => {
    console.log(`Acesse http://localhost:${PORT}`);
});