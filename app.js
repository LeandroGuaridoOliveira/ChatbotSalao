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
        dia TEXT,
        horario TEXT,
        funcionario_id INTEGER,
        FOREIGN KEY (cliente_id) REFERENCES clientes(id),
        FOREIGN KEY (funcionario_id) REFERENCES funcionarios(id)
      );
    `);
  
    await db.run(`
      CREATE TABLE IF NOT EXISTS agendamento_procedimentos (
        agendamento_id INTEGER,
        procedimento_id INTEGER,
        FOREIGN KEY (agendamento_id) REFERENCES agendamentos(id),
        FOREIGN KEY (procedimento_id) REFERENCES procedimentos(id)
      );
    `);
  
    // 👇 Adições do passo 3
    await db.run(`
      CREATE TABLE IF NOT EXISTS especialidades (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        nome TEXT UNIQUE
      );
    `);
  
    await db.run(`
      CREATE TABLE IF NOT EXISTS funcionario_especialidades (
        funcionario_id INTEGER,
        especialidade_id INTEGER,
        FOREIGN KEY (funcionario_id) REFERENCES funcionarios(id),
        FOREIGN KEY (especialidade_id) REFERENCES especialidades(id),
        PRIMARY KEY (funcionario_id, especialidade_id)
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

    async function inserirEspecialidadesPadrao() {
        const db = await abrirBanco();
        const padroes = ["Cabelereiro", "Manicure", "Pedicure", "Estética", "Colorista"];
        for (const nome of padroes) {
          await db.run(`INSERT OR IGNORE INTO especialidades (nome) VALUES (?)`, [nome]);
        }
        await db.close();
      }
      

    const row = await db.get('SELECT COUNT(*) as total FROM procedimentos');
    if (row.total === 0) {
        for (const p of procedimentos) {
            await db.run('INSERT INTO procedimentos (nome, valor) VALUES (?, ?)', [p.nome, p.valor]);
        }
    }
    await db.close();
}

// Função para atualizar estrutura do banco (caso a coluna funcionario_id não exista ainda)
async function atualizarEstruturaBanco() {
    const db = await abrirBanco();
    const colunas = await db.all(`PRAGMA table_info(agendamentos)`);
    const existe = colunas.some(c => c.name === 'funcionario_id');
    if (!existe) {
      await db.run(`ALTER TABLE agendamentos ADD COLUMN funcionario_id INTEGER`);
    }
    await db.close();
  }
  
  // Função para inserir especialidades padrão no banco
  async function inserirEspecialidadesPadrao() {
    const db = await abrirBanco();
    const padroes = ["Cabelereiro", "Manicure", "Pedicure", "Estética", "Colorista"];
    for (const nome of padroes) {
      await db.run(`INSERT OR IGNORE INTO especialidades (nome) VALUES (?)`, [nome]);
    }
    await db.close();
  }
  

  (async () => {
    await inicializarUsuarios();
    await inicializarTabelas();
    await atualizarEstruturaBanco(); // Agora definida
    await inserirProcedimentosIniciais();
    await inserirEspecialidadesPadrao(); // Agora definida
  })();
  
  
function formatarCPF(cpf) {
    return cpf.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, "$1.$2.$3-$4");
}

function requireLogin(req, res, next) {
    if (req.session && req.session.usuarioLogado) return next();
    res.redirect('/login');
}

// ROTAS
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

app.post('/alterar-senha', requireLogin, async (req, res) => {
    const { senhaAtual, novaSenha, confirmarSenha } = req.body;
    const usuario = req.session.usuarioLogado;
    const db = await abrirBanco();
    const usuarioDb = await db.get('SELECT * FROM usuarios WHERE login = ?', [usuario]);
    if (!usuarioDb || !bcrypt.compareSync(senhaAtual, usuarioDb.senhaHash)) {
        await db.close();
        return res.render('alterarSenha', { msg: { tipo: 'erro', texto: 'Senha atual incorreta!' } });
    }
    if (novaSenha.length < 5 || novaSenha !== confirmarSenha) {
        await db.close();
        return res.render('alterarSenha', { msg: { tipo: 'erro', texto: 'Nova senha inválida ou não confere.' } });
    }
    const novaHash = bcrypt.hashSync(novaSenha, 10);
    await db.run('UPDATE usuarios SET senhaHash = ? WHERE login = ?', [novaHash, usuario]);
    await db.close();
    return res.render('alterarSenha', { msg: { tipo: 'sucesso', texto: 'Senha alterada com sucesso!' } });
});

app.get('/agendamentos', requireLogin, async (req, res) => {
    const { filtro, valorTexto, valorProcedimento, valorData, valorFuncionario } = req.query;

    let whereClauses = [];
    let params = [];

    if (filtro) {
        if (filtro === 'nome') {
            whereClauses.push('c.nome LIKE ?');
            params.push(`%${valorTexto}%`);
        } else if (filtro === 'cpf') {
            whereClauses.push('c.cpf LIKE ?');
            params.push(`%${valorTexto.replace(/\D/g, '')}%`);
        } else if (filtro === 'procedimento') {
            whereClauses.push('p.id = ?');
            params.push(valorProcedimento);
        } else if (filtro === 'dia') {
            whereClauses.push('a.dia = ?');
            params.push(valorData);
        } else if (filtro === 'funcionario') {
            whereClauses.push('a.funcionario_id = ?');
            params.push(valorFuncionario);
        }
    }

    let where = whereClauses.length ? 'WHERE ' + whereClauses.join(' AND ') : '';

    const sql = `
        SELECT 
            a.id AS agendamento_id,
            c.nome AS cliente_nome,
            c.cpf AS cliente_cpf,
            a.dia,
            a.horario,
            f.nome AS funcionario_nome,
            f.especialidade AS funcionario_especialidade,
            IFNULL(GROUP_CONCAT(p.nome, ', '), '') AS nomes_procedimentos,
            IFNULL(SUM(p.valor), 0) AS valor_total
        FROM agendamentos a
        JOIN clientes c ON a.cliente_id = c.id
        LEFT JOIN funcionarios f ON a.funcionario_id = f.id
        LEFT JOIN agendamento_procedimentos ap ON ap.agendamento_id = a.id
        LEFT JOIN procedimentos p ON p.id = ap.procedimento_id
        ${where}
        GROUP BY a.id
    `;

    const db = await abrirBanco();
    const ags = await db.all(sql, params);
    const listaProcedimentos = await db.all('SELECT * FROM procedimentos');
    const funcionarios = await db.all('SELECT * FROM funcionarios');
    await db.close();

    ags.forEach(a => {
        a.cliente_cpf = formatarCPF(a.cliente_cpf);
    });

    const msg = req.session.msg;
    delete req.session.msg;
    
    res.render('agendamentos', {
        ags,
        listaProcedimentos,
        funcionarios,
        filtro,
        valorTexto,
        valorProcedimento,
        valorData,
        valorFuncionario,
        msg,
        valor: filtro === 'nome' || filtro === 'cpf' ? valorTexto
            : filtro === 'procedimento' ? valorProcedimento
            : filtro === 'dia' ? valorData
            : filtro === 'funcionario' ? valorFuncionario
            : ''
    });
});

app.get('/novo-agendamento', requireLogin, async (req, res) => {
    const db = await abrirBanco();
    const procedimentos = await db.all('SELECT * FROM procedimentos');
    const funcionarios = await db.all('SELECT * FROM funcionarios');
    await db.close();
    res.render('novoAgendamento', { procedimentos, funcionarios, msg: null });
});

app.post('/novo-agendamento', requireLogin, async (req, res) => {
    let { nome, cpf, dia, horario, procedimento_id, funcionario_id } = req.body;

    const db = await abrirBanco();
    const procedimentos = await db.all('SELECT * FROM procedimentos');
    const funcionarios = await db.all('SELECT * FROM funcionarios');

    if (!Array.isArray(procedimento_id)) procedimento_id = [procedimento_id];
    procedimento_id = procedimento_id.filter(p => p !== '');

    let cpfLimpo = cpf.replace(/\D/g, '');

    if (!funcionario_id || cpfLimpo.length !== 11 || procedimento_id.length === 0) {
        await db.close();
        return res.render('novoAgendamento', {
            procedimentos,
            funcionarios,
            msg: 'Dados inválidos. Verifique todos os campos.'
        });
    }

    let cliente = await db.get('SELECT * FROM clientes WHERE cpf = ?', [cpfLimpo]);
    if (!cliente) {
        await db.run('INSERT INTO clientes (nome, cpf) VALUES (?, ?)', [nome, cpfLimpo]);
        cliente = await db.get('SELECT * FROM clientes WHERE cpf = ?', [cpfLimpo]);
    }

    await db.run(
        'INSERT INTO agendamentos (cliente_id, dia, horario, funcionario_id) VALUES (?, ?, ?, ?)',
        [cliente.id, dia, horario, funcionario_id]
    );

    const agendamento = await db.get('SELECT last_insert_rowid() as id');

    for (const pid of procedimento_id) {
        await db.run(
            'INSERT INTO agendamento_procedimentos (agendamento_id, procedimento_id) VALUES (?, ?)',
            [agendamento.id, pid]
        );
    }

    await db.close();
    res.redirect('/agendamentos');
});

app.post('/apagar-agendamento/:id', requireLogin, async (req, res) => {
    const db = await abrirBanco();
    await db.run('DELETE FROM agendamento_procedimentos WHERE agendamento_id = ?', [req.params.id]);
    await db.run('DELETE FROM agendamentos WHERE id = ?', [req.params.id]);
    await db.close();
    res.redirect('/agendamentos');
});

app.get('/funcionarios', requireLogin, async (req, res) => {
    const db = await abrirBanco();

    const funcionarios = await db.all(`
        SELECT f.id, f.nome,
               GROUP_CONCAT(e.nome, ', ') AS especialidades
        FROM funcionarios f
        LEFT JOIN funcionario_especialidades fe ON f.id = fe.funcionario_id
        LEFT JOIN especialidades e ON fe.especialidade_id = e.id
        GROUP BY f.id
    `);

    const especialidades = await db.all('SELECT * FROM especialidades');

    await db.close();

    res.render('funcionarios', {
        funcionarios,
        especialidades,
        msg: req.session.msg || null
    });

    delete req.session.msg;
});


app.post('/funcionarios', requireLogin, async (req, res) => {
    const { nome } = req.body;
    let especialidade_ids = req.body.especialidade_ids;

    if (!Array.isArray(especialidade_ids)) {
        especialidade_ids = especialidade_ids ? [especialidade_ids] : [];
    }

    const db = await abrirBanco();
    try {
        const result = await db.run('INSERT INTO funcionarios (nome, especialidade) VALUES (?, ?)', [nome, '']);

        const funcionarioId = result.lastID;

        for (const espId of especialidade_ids) {
            await db.run('INSERT INTO funcionario_especialidades (funcionario_id, especialidade_id) VALUES (?, ?)', [funcionarioId, espId]);
        }

        const funcionarios = await db.all('SELECT * FROM funcionarios');
        const especialidades = await db.all('SELECT * FROM especialidades');

        res.render('funcionarios', {
            funcionarios,
            especialidades,
            msg: 'Funcionário cadastrado com sucesso!'
        });
    } catch (err) {
        const funcionarios = await db.all('SELECT * FROM funcionarios');
        const especialidades = await db.all('SELECT * FROM especialidades');
        res.render('funcionarios', {
            funcionarios,
            especialidades,
            msg: 'Erro ao cadastrar funcionário: ' + err.message
        });
    } finally {
        await db.close();
    }
});


app.post('/funcionarios/:id/excluir', requireLogin, async (req, res) => {
    const db = await abrirBanco();
    try {
        await db.run('DELETE FROM funcionarios WHERE id = ?', [req.params.id]);
        const funcionarios = await db.all('SELECT * FROM funcionarios');
        const especialidades = await db.all('SELECT * FROM especialidades'); // ✅ Adicionado
        res.render('funcionarios', {
            funcionarios,
            especialidades,
            msg: 'Funcionário excluído com sucesso!'
        });
    } catch (err) {
        const funcionarios = await db.all('SELECT * FROM funcionarios');
        const especialidades = await db.all('SELECT * FROM especialidades'); // ✅ Também aqui
        res.render('funcionarios', {
            funcionarios,
            especialidades,
            msg: 'Erro ao excluir: ' + err.message
        });
    } finally {
        await db.close();
    }
});


// NOVA ROTA: horários ocupados para AJAX
app.get('/horarios-ocupados', async (req, res) => {
    const { funcionario_id, dia } = req.query;
    if (!funcionario_id || !dia) return res.json([]);

    try {
        const db = await abrirBanco();
        const horarios = await db.all(
            'SELECT horario FROM agendamentos WHERE funcionario_id = ? AND dia = ?',
            [funcionario_id, dia]
        );
        await db.close();
        const ocupados = horarios.map(h => h.horario);
        res.json(ocupados);
    } catch (error) {
        console.error(error);
        res.status(500).json([]);
    }
});

app.get('/editar-agendamento/:id', requireLogin, async (req, res) => {
    const id = req.params.id;
    const db = await abrirBanco();

    const agendamento = await db.get(`SELECT * FROM agendamentos WHERE id = ?`, [id]);
    const cliente = await db.get(`SELECT * FROM clientes WHERE id = ?`, [agendamento.cliente_id]);
    const procedimentosSelecionados = await db.all(`SELECT procedimento_id FROM agendamento_procedimentos WHERE agendamento_id = ?`, [id]);

    const procedimentos = await db.all('SELECT * FROM procedimentos');
    const funcionarios = await db.all('SELECT * FROM funcionarios');

    await db.close();

    const procedimentoIds = procedimentosSelecionados.map(p => p.procedimento_id);

    res.render('editarAgendamento', {
        agendamento,
        cliente,
        procedimentos,
        funcionarios,
        procedimentoIds,
        msg: null
    });
});

app.post('/editar-agendamento/:id', requireLogin, async (req, res) => {
    const id = req.params.id;
    let { nome, cpf, dia, horario, funcionario_id, procedimento_id } = req.body;

    const db = await abrirBanco();
    const procedimentos = await db.all(`SELECT * FROM procedimentos`);
    const funcionarios = await db.all(`SELECT * FROM funcionarios`);

    if (!Array.isArray(procedimento_id)) procedimento_id = [procedimento_id];
    procedimento_id = procedimento_id.filter(p => p !== '');

    let cpfLimpo = cpf.replace(/\D/g, '');

    if (!funcionario_id || cpfLimpo.length !== 11 || procedimento_id.length === 0) {
        return res.render('editarAgendamento', {
            agendamento: { id, nome, cpf, dia, horario, funcionario_id },
            procedimentos,
            funcionarios,
            selecionadosIds: procedimento_id.map(Number),
            msg: 'Dados inválidos. Verifique todos os campos.'
        });
    }
    
    // Verifica conflito de horário com outro agendamento
    const conflito = await db.get(`
        SELECT * FROM agendamentos
        WHERE dia = ? AND horario = ? AND funcionario_id = ? AND id != ?
    `, [dia, horario, funcionario_id, id]);

    if (conflito) {
        await db.close();
        return res.render('editarAgendamento', {
            agendamento: { id, nome, cpf, dia, horario, funcionario_id },
            procedimentos,
            funcionarios,
            selecionadosIds: procedimento_id.map(Number),
            msg: 'Já existe um agendamento neste horário com esse funcionário.'
        });
    }

    // Atualiza ou insere cliente
    let cliente = await db.get('SELECT * FROM clientes WHERE cpf = ?', [cpfLimpo]);
    if (!cliente) {
        await db.run('INSERT INTO clientes (nome, cpf) VALUES (?, ?)', [nome, cpfLimpo]);
        cliente = await db.get('SELECT * FROM clientes WHERE cpf = ?', [cpfLimpo]);
    }

    await db.run(`
        UPDATE agendamentos
        SET cliente_id = ?, dia = ?, horario = ?, funcionario_id = ?
        WHERE id = ?
    `, [cliente.id, dia, horario, funcionario_id, id]);

    await db.run('DELETE FROM agendamento_procedimentos WHERE agendamento_id = ?', [id]);
    for (const pid of procedimento_id) {
        await db.run('INSERT INTO agendamento_procedimentos (agendamento_id, procedimento_id) VALUES (?, ?)', [id, pid]);
    }

    await db.close();
    req.session.msg = 'Agendamento atualizado com sucesso!';
    res.redirect('/agendamentos');
    });

    app.post('/excluir-funcionario/:id', requireLogin, async (req, res) => {
        const id = req.params.id;
        const db = await abrirBanco();
      
        await db.run('DELETE FROM funcionario_especialidades WHERE funcionario_id = ?', [id]);
        await db.run('DELETE FROM funcionarios WHERE id = ?', [id]);
      
        await db.close();
      
        req.session.msg = 'Funcionário excluído com sucesso!';
        res.redirect('/funcionarios');
      });
      
      app.get('/editar-funcionario/:id', requireLogin, async (req, res) => {
        const db = await abrirBanco();
        const id = req.params.id;
      
        const funcionario = await db.get('SELECT * FROM funcionarios WHERE id = ?', [id]);
        const especialidades = await db.all('SELECT * FROM especialidades');
        const vinculos = await db.all('SELECT especialidade_id FROM funcionario_especialidades WHERE funcionario_id = ?', [id]);
      
        await db.close();
      
        const especialidadeIds = vinculos.map(e => e.especialidade_id);
      
        res.render('editarFuncionario', {
          funcionario,
          especialidades,
          especialidadeIds
        });
      });
      

      app.post('/editar-funcionario/:id', requireLogin, async (req, res) => {
        const id = req.params.id;
        const { nome, especialidade_ids } = req.body;
      
        const db = await abrirBanco();
      
        await db.run('UPDATE funcionarios SET nome = ? WHERE id = ?', [nome, id]);
        await db.run('DELETE FROM funcionario_especialidades WHERE funcionario_id = ?', [id]);
      
        const lista = Array.isArray(especialidade_ids) ? especialidade_ids : [especialidade_ids];
        for (const espId of lista.filter(Boolean)) {
          await db.run('INSERT INTO funcionario_especialidades (funcionario_id, especialidade_id) VALUES (?, ?)', [id, espId]);
        }
      
        await db.close();
        req.session.msg = 'Funcionário atualizado com sucesso!';
        res.redirect('/funcionarios');
      });
      

app.get('/', (req, res) => res.redirect('/agendamentos'));

app.listen(PORT, () => {
    console.log(`Acesse http://localhost:${PORT}`);
});
