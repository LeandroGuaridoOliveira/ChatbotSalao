const express = require('express');
const session = require('express-session');
const bcrypt = require('bcrypt');
const sqlite3 = require('sqlite3');
const { open } = require('sqlite');
const path = require('path');
const dayjs = require('dayjs');
const duration = require('dayjs/plugin/duration');
const isSameOrBefore = require('dayjs/plugin/isSameOrBefore');
const fs = require('fs');
const PDFDocument = require('pdfkit'); 
const { enviarEmailBoasVindas } = require('./emailService');
const { enviarConviteFuncionario } = require('./emailService');
dayjs.extend(isSameOrBefore);
dayjs.extend(duration);


// Função para registrar erros
function registrarErro(mensagem) {
    const dataHora = new Date().toLocaleString('pt-BR');
    const logMessage = `[${dataHora}] - ${mensagem}\n`;

    const caminhoLog = path.join(__dirname, 'logs', 'erros.log');

    // Garante que a pasta logs exista
    if (!fs.existsSync(path.join(__dirname, 'logs'))) {
        fs.mkdirSync(path.join(__dirname, 'logs'));
    }

    fs.appendFile(caminhoLog, logMessage, (err) => {
        if (err) console.error('Erro ao escrever no log:', err);
    });
}



const app = express();
app.use(express.urlencoded({ extended: true })); // ✅ agora pode usar
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
              empresa_id INTEGER,
              nome TEXT,
              email TEXT UNIQUE,
              senha TEXT,
              tipo TEXT,
              token_redefinicao TEXT,
              expira_token TEXT,
              FOREIGN KEY (empresa_id) REFERENCES empresas(id)
          );
      `);
  
      await db.close();
      }

      async function inicializarTabelas() {
        const db = await abrirBanco();
      
        // ───────────────────────────────
        // 1. Tabela de empresas
        // ───────────────────────────────
        await db.run(`
          CREATE TABLE IF NOT EXISTS empresas (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            nome_empresa TEXT NOT NULL,
            email_admin TEXT NOT NULL UNIQUE,
            senha_admin TEXT NOT NULL
          );
        `);
      
        // ───────────────────────────────
        // 2. Usuários
        // ───────────────────────────────
        await db.run(`
          CREATE TABLE IF NOT EXISTS usuarios (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            empresa_id INTEGER,
            nome TEXT,
            email TEXT UNIQUE,
            senha TEXT,
            tipo TEXT,
            token_redefinicao TEXT,
            expira_token TEXT,
            FOREIGN KEY (empresa_id) REFERENCES empresas(id)
          );
        `);
      
        // ───────────────────────────────
        // 3. Clientes
        // ───────────────────────────────
        await db.run(`
          CREATE TABLE IF NOT EXISTS clientes (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            nome TEXT,
            cpf TEXT UNIQUE,
            empresa_id INTEGER,
            FOREIGN KEY (empresa_id) REFERENCES empresas(id)
          );
        `);
      
        // ───────────────────────────────
        // 4. Procedimentos
        // ───────────────────────────────
        await db.run(`
          CREATE TABLE IF NOT EXISTS procedimentos (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            nome TEXT,
            valor REAL,
            duracao INTEGER,
            empresa_id INTEGER,
            FOREIGN KEY (empresa_id) REFERENCES empresas(id)
          );
        `);
      
        // (Retrocompatibilidade — opcional)
        const cols = await db.all(`PRAGMA table_info(procedimentos)`);
        const temDuracao = cols.some(c => c.name === 'duracao');
        if (!temDuracao) {
          await db.run(`ALTER TABLE procedimentos ADD COLUMN duracao INTEGER`);
        }
      
        // ───────────────────────────────
        // 5. Funcionários
        // ───────────────────────────────
        await db.run(`
          CREATE TABLE IF NOT EXISTS funcionarios (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            nome TEXT NOT NULL,
            email TEXT,
            telefone TEXT,
            especialidade TEXT,
            ativo INTEGER DEFAULT 1,
            empresa_id INTEGER,
            FOREIGN KEY (empresa_id) REFERENCES empresas(id)

            );
          
        `);        
      
        const colunasFunc = await db.all(`PRAGMA table_info(funcionarios)`);

      if (!colunasFunc.some(c => c.name === 'email')) {
        await db.run(`ALTER TABLE funcionarios ADD COLUMN email TEXT`);
      }
      if (!colunasFunc.some(c => c.name === 'telefone')) {
        await db.run(`ALTER TABLE funcionarios ADD COLUMN telefone TEXT`);
      }

        // ───────────────────────────────
        // 6. Agendamentos
        // ───────────────────────────────
        await db.run(`
          CREATE TABLE IF NOT EXISTS agendamentos (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            cliente_id INTEGER,
            dia TEXT,
            horario TEXT,
            funcionario_id INTEGER,
            empresa_id INTEGER,
            finalizado INTEGER DEFAULT 0,
            FOREIGN KEY (cliente_id) REFERENCES clientes(id),
            FOREIGN KEY (funcionario_id) REFERENCES funcionarios(id),
            FOREIGN KEY (empresa_id) REFERENCES empresas(id)
          );
        `);
      
        // ───────────────────────────────
        // 7. Tabela de junção: agendamento_procedimentos
        // ───────────────────────────────
        await db.run(`
          CREATE TABLE IF NOT EXISTS agendamento_procedimentos (
            agendamento_id INTEGER,
            procedimento_id INTEGER,
            PRIMARY KEY (agendamento_id, procedimento_id),
            FOREIGN KEY (agendamento_id) REFERENCES agendamentos(id),
            FOREIGN KEY (procedimento_id) REFERENCES procedimentos(id)
          );
        `);
      
        // ───────────────────────────────
        // 8. Especialidades
        // ───────────────────────────────
        await db.run(`
          CREATE TABLE IF NOT EXISTS especialidades (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            nome TEXT,
            empresa_id INTEGER,
            UNIQUE(nome, empresa_id),
            FOREIGN KEY (empresa_id) REFERENCES empresas(id)
          );
        `);
      
        // ───────────────────────────────
        // 9. Tabela de junção: funcionario_especialidades
        // ───────────────────────────────
        await db.run(`
          CREATE TABLE IF NOT EXISTS funcionario_especialidades (
            funcionario_id INTEGER,
            especialidade_id INTEGER,
            PRIMARY KEY (funcionario_id, especialidade_id),
            FOREIGN KEY (funcionario_id) REFERENCES funcionarios(id),
            FOREIGN KEY (especialidade_id) REFERENCES especialidades(id)
          );
        `);
      
        // ───────────────────────────────
        // 10. Horários avulsos (usado em alguns casos)
        // ───────────────────────────────
        await db.run(`
          CREATE TABLE IF NOT EXISTS horarios_funcionarios (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            funcionario_id INTEGER,
            dia_semana TEXT,
            horario TEXT,
            FOREIGN KEY (funcionario_id) REFERENCES funcionarios(id)
          );
        `);
      
        // ───────────────────────────────
        // 11. Horários de expediente
        // ───────────────────────────────
        await db.run(`
          CREATE TABLE IF NOT EXISTS horarios_expeds (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            funcionario_id INTEGER,
            dia_semana TEXT,
            inicio TEXT,
            fim TEXT,
            FOREIGN KEY (funcionario_id) REFERENCES funcionarios(id)
          );
        `);
      
        // ───────────────────────────────
        // 12. Tabela de junção: procedimento_especialidade
        // ───────────────────────────────
        await db.run(`
          CREATE TABLE IF NOT EXISTS procedimento_especialidade (
            procedimento_id INTEGER,
            especialidade_id INTEGER,
            PRIMARY KEY (procedimento_id, especialidade_id),
            FOREIGN KEY (procedimento_id) REFERENCES procedimentos(id),
            FOREIGN KEY (especialidade_id) REFERENCES especialidades(id)
          );
        `);
      
        await db.close();
      }
      
      async function inserirProcedimentosIniciais(empresaId) {
        const db = await abrirBanco();
        const procedimentos = [
          { nome: "Corte Feminino", valor: 60, duracao: 40 },
          { nome: "Corte Masculino", valor: 40, duracao: 30 },
          { nome: "Escova", valor: 50, duracao: 45 },
          { nome: "Manicure", valor: 30, duracao: 30 },
          { nome: "Pedicure", valor: 35, duracao: 30 }
        ];
      
        const row = await db.get('SELECT COUNT(*) as total FROM procedimentos WHERE empresa_id = ?', [empresaId]);
        if (row.total === 0) {
          for (const p of procedimentos) {
            await db.run(
              'INSERT INTO procedimentos (nome, valor, duracao, empresa_id) VALUES (?, ?, ?, ?)',
              [p.nome, p.valor, p.duracao, empresaId]
            );
          }
        }
      
        await db.close();
      }
      
      async function listarProcedimentos(empresaId) {
        const db = await abrirBanco();
        const procedimentos = await db.all(
          'SELECT * FROM procedimentos WHERE empresa_id = ?',
          [empresaId]
        );
        await db.close();
        return procedimentos;
      }
      
      

async function inserirOuObterCliente(nome, cpf, empresaId) {
  const db = await abrirBancoComRetry();
  let cliente = await db.get('SELECT * FROM clientes WHERE cpf = ? AND empresa_id = ?', [cpf, empresaId]);
  if (!cliente) {
      await db.run('INSERT INTO clientes (nome, cpf, empresa_id) VALUES (?, ?, ?)', [nome, cpf, empresaId]);
      cliente = await db.get('SELECT * FROM clientes WHERE cpf = ? AND empresa_id = ?', [cpf, empresaId]);
  }
  await db.close();
  return cliente;
}


async function inserirAgendamento(cliente_id, funcionario_id, dia, horario, empresa_id) {
  const db = await abrirBancoComRetry();

  await db.run(`
    INSERT INTO agendamentos (cliente_id, funcionario_id, dia, horario, empresa_id)
    VALUES (?, ?, ?, ?, ?)`,
    [cliente_id, funcionario_id, dia, horario, empresa_id]
  );

  const agendamento = await db.get('SELECT last_insert_rowid() as id');

  await db.close();
  return agendamento.id;
}

async function buscarProcedimentoPorId(id) {
    const db = await abrirBancoComRetry();
    const procedimento = await db.get('SELECT * FROM procedimentos WHERE id = ?', [id]);
    await db.close();
    return procedimento;
}
async function listarAgendamentosCompletos(empresaId) {
  const db = await abrirBancoComRetry();
  const agendamentos = await db.all(`
      SELECT 
          a.id AS agendamento_id,
          c.nome AS cliente_nome,
          c.cpf AS cliente_cpf,
          a.dia,
          a.horario,
          IFNULL(GROUP_CONCAT(p.nome, ', '), '') AS nomes_procedimentos,
          IFNULL(SUM(p.valor), 0) AS valor_total
      FROM agendamentos a
      JOIN clientes c ON a.cliente_id = c.id AND c.empresa_id = ?
      LEFT JOIN agendamento_procedimentos ap ON ap.agendamento_id = a.id
      LEFT JOIN procedimentos p ON p.id = ap.procedimento_id AND p.empresa_id = ?
      WHERE a.empresa_id = ?
      GROUP BY a.id
  `, [empresaId, empresaId, empresaId]);

  await db.close();
  return agendamentos;
}



(async () => {
  await inicializarUsuarios();
  await inicializarTabelas();

  const empresaId = await criarEmpresaEAdminPadrao(); // ✅ Declarado uma vez só

  await atualizarEstruturaBanco();
  await inserirEspecialidadesPadrao(empresaId);       // ✅ usa a variável
  await inserirProcedimentosIniciais(empresaId);      // ✅ usa a variável
})();


const delay = ms => new Promise(res => setTimeout(res, ms));

const sendMessageWithTyping = async (chat, client, to, message, typingDelay = 1500, messageDelay = 500) => {
    await delay(typingDelay);
    await chat.sendStateTyping();
    await delay(messageDelay);
    await client.sendMessage(to, message);
};


async function criarEmpresaEAdminPadrao() {
  const db = await abrirBanco();

  const empresaExistente = await db.get('SELECT * FROM empresas LIMIT 1');

  if (!empresaExistente) {
    console.log('Nenhuma empresa encontrada. Criando empresa e admin padrão...');

    const senhaHash = await bcrypt.hash('admin123', 10);

    await db.run(`
      INSERT INTO empresas (nome_empresa, email_admin, senha_admin)
      VALUES (?, ?, ?)
    `, ['Minha Empresa Exemplo', 'admin@example.com', senhaHash]);

    const empresaCriada = await db.get('SELECT id FROM empresas WHERE email_admin = ?', ['admin@example.com']);

    await db.run(`
      INSERT INTO usuarios (empresa_id, nome, email, senha, tipo)
      VALUES (?, ?, ?, ?, ?)
    `, [empresaCriada.id, 'Administrador', 'admin@example.com', senhaHash, 'admin']);

    console.log('Empresa e administrador padrão criados com sucesso!');
    await db.close();
    return empresaCriada.id; // ✅ Retorna o ID criado
  }

  await db.close();
  return empresaExistente.id; // ✅ Retorna o ID existente
}


async function inserirProcedimentosIniciais(empresaId) {
  const db = await abrirBanco();

  const procedimentos = [
    { nome: "Corte Feminino", valor: 60, duracao: 40 },
    { nome: "Corte Masculino", valor: 40, duracao: 30 },
    { nome: "Escova", valor: 50, duracao: 45 },
    { nome: "Manicure", valor: 30, duracao: 30 },
    { nome: "Pedicure", valor: 35, duracao: 30 }
  ];

  const row = await db.get('SELECT COUNT(*) as total FROM procedimentos WHERE empresa_id = ?', [empresaId]);

  if (row.total === 0) {
    for (const p of procedimentos) {
      await db.run(
        'INSERT INTO procedimentos (nome, valor, duracao, empresa_id) VALUES (?, ?, ?, ?)',
        [p.nome, p.valor, p.duracao, empresaId]
      );
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
  async function atualizarEstruturaBanco() {
    const db = await abrirBanco();
  
    const colunas = await db.all(`PRAGMA table_info(agendamentos)`);
  
    const temFuncionarioId = colunas.some(c => c.name === 'funcionario_id');
    const temEmpresaId = colunas.some(c => c.name === 'empresa_id');
  
    if (!temFuncionarioId) {
      console.log('⏳ Adicionando coluna funcionario_id na tabela agendamentos...');
      await db.run(`ALTER TABLE agendamentos ADD COLUMN funcionario_id INTEGER`);
      // OBS: não é possível adicionar FOREIGN KEY via ALTER TABLE no SQLite
    }
  
    if (!temEmpresaId) {
      console.log('⏳ Adicionando coluna empresa_id na tabela agendamentos...');
      await db.run(`ALTER TABLE agendamentos ADD COLUMN empresa_id INTEGER`);
    }
  
    await db.close();
  }
  
  

  // Função para inserir especialidades padrão no banco
// Função para inserir especialidades padrão vinculadas a uma empresa específica
async function inserirEspecialidadesPadrao(empresaId) {
  const db = await abrirBanco();
  const padroes = ["Cabelereiro", "Manicure", "Pedicure", "Estética", "Colorista"];

  for (const nome of padroes) {
    await db.run(
      'INSERT OR IGNORE INTO especialidades (nome, empresa_id) VALUES (?, ?)',
      [nome, empresaId]
    );
  }

  await db.close();
}

(async () => {
  await inicializarUsuarios();
  await inicializarTabelas();
  await atualizarEstruturaBanco();

  const empresaId = await criarEmpresaEAdminPadrao(); // retorna o ID

  await inserirEspecialidadesPadrao(empresaId);
  await inserirProcedimentosIniciais(empresaId);
})();
  
  
function formatarCPF(cpf) {
    return cpf.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, "$1.$2.$3-$4");
}

function requireLogin(req, res, next) {
  if (
    req.session &&
    req.session.usuarioLogado &&
    req.session.empresa_id &&
    req.session.tipo
  ) {
    return next();
  }

  // Se quiser adicionar feedback visual, pode usar flash ou uma mensagem
  // req.session.msg = "Faça login para continuar.";
  res.redirect('/login');
}

// ROTAS
app.get('/login', (req, res) => {
  res.render('login', { erro: null });
});



app.get('/logout', (req, res) => {
  req.session.destroy(err => {
    if (err) {
      console.error('Erro ao destruir a sessão:', err);
      return res.send('Erro ao fazer logout.');
    }
    res.redirect('/login');
  });
});


app.get('/alterar-senha', requireLogin, (req, res) => {
    res.render('alterarSenha', { msg: null });
});
app.post('/alterar-senha', requireLogin, async (req, res) => {
  const { senhaAtual, novaSenha, confirmarSenha } = req.body;
  const usuario = req.session.usuarioLogado; // objeto com email e empresa_id

  const db = await abrirBanco();

  const usuarioDb = await db.get(
    'SELECT * FROM usuarios WHERE email = ? AND empresa_id = ?',
    [usuario.email, usuario.empresa_id]
  );

  if (!usuarioDb) {
    await db.close();
    return res.render('alterarSenha', {
      msg: { tipo: 'erro', texto: 'Usuário não encontrado.' }
    });
  }

  const senhaCorreta = await bcrypt.compare(senhaAtual, usuarioDb.senha);
  if (!senhaCorreta) {
    await db.close();
    return res.render('alterarSenha', {
      msg: { tipo: 'erro', texto: 'Senha atual incorreta!' }
    });
  }

  if (novaSenha.length < 5 || novaSenha !== confirmarSenha) {
    await db.close();
    return res.render('alterarSenha', {
      msg: { tipo: 'erro', texto: 'Nova senha inválida ou não confere.' }
    });
  }

  const novaHash = await bcrypt.hash(novaSenha, 10);
  await db.run(
    'UPDATE usuarios SET senha = ? WHERE id = ? AND empresa_id = ?',
    [novaHash, usuarioDb.id, usuarioDb.empresa_id]
  );

  await db.close();
  return res.render('alterarSenha', {
    msg: { tipo: 'sucesso', texto: 'Senha alterada com sucesso!' }
  });
});


app.get('/agendamentos', requireLogin, async (req, res) => {
  const { filtro, valorTexto, valorProcedimento, valorData, valorFuncionario } = req.query;
  const empresaId = req.session.usuarioLogado.empresa_id;

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
      whereClauses.push(`a.id IN (
        SELECT agendamento_id FROM agendamento_procedimentos WHERE procedimento_id = ?
      )`);
      params.push(valorProcedimento);
    } else if (filtro === 'dia') {
      whereClauses.push('a.dia = ?');
      params.push(valorData);
    } else if (filtro === 'funcionario') {
      whereClauses.push('a.funcionario_id = ?');
      params.push(valorFuncionario);
    }
  }

  whereClauses.push('a.finalizado = 0');
  whereClauses.push('a.empresa_id = ?');
  params.push(empresaId);

  const where = 'WHERE ' + whereClauses.join(' AND ');

  const sql = `
    SELECT 
      a.id AS agendamento_id,
      c.nome AS cliente_nome,
      c.cpf AS cliente_cpf,
      a.dia,
      a.horario,
      f.nome AS funcionario_nome,
      IFNULL(GROUP_CONCAT(DISTINCT p.nome), '') AS nomes_procedimentos,
      IFNULL(SUM(p.valor), 0) AS valor_total
    FROM agendamentos a
    JOIN clientes c ON a.cliente_id = c.id AND c.empresa_id = ?
    LEFT JOIN funcionarios f ON a.funcionario_id = f.id AND f.empresa_id = ?
    LEFT JOIN agendamento_procedimentos ap ON ap.agendamento_id = a.id
    LEFT JOIN procedimentos p ON p.id = ap.procedimento_id AND p.empresa_id = ?
    ${where}
    GROUP BY a.id
    ORDER BY a.dia, a.horario
  `;

  const db = await abrirBanco();
  const ags = await db.all(sql, [empresaId, empresaId, empresaId, ...params]);
  const listaProcedimentos = await db.all('SELECT * FROM procedimentos WHERE empresa_id = ?', [empresaId]);
  const funcionarios = await db.all('SELECT * FROM funcionarios WHERE empresa_id = ?', [empresaId]);
  await db.close();

  ags.forEach(a => {
    a.cliente_cpf = formatarCPF(a.cliente_cpf);
  });

  const msg = req.session.msg || null;
  delete req.session.msg;

  res.render('agendamentos', {
    ags: ags || [],
    listaProcedimentos: listaProcedimentos || [],
    funcionarios: funcionarios || [],
    filtro: filtro || '',
    valorTexto: valorTexto || '',
    valorProcedimento: valorProcedimento || '',
    valorData: valorData || '',
    valorFuncionario: valorFuncionario || '',
    msg,
    valor:
      filtro === 'nome' || filtro === 'cpf' ? valorTexto :
      filtro === 'procedimento' ? valorProcedimento :
      filtro === 'dia' ? valorData :
      filtro === 'funcionario' ? valorFuncionario :
      '',
    tipo: req.session.tipo,
    nome_usuario: req.session.nome_usuario
  });
});

app.get('/novo-agendamento', requireLogin, async (req, res) => {
  const db = await abrirBanco();
  const clientes = await db.all('SELECT * FROM clientes WHERE empresa_id = ?', [req.session.usuarioLogado.empresa_id]);
  const funcionarios = await db.all('SELECT * FROM funcionarios WHERE empresa_id = ?', [req.session.usuarioLogado.empresa_id]);
  const procedimentos = await db.all('SELECT * FROM procedimentos WHERE empresa_id = ?', [req.session.usuarioLogado.empresa_id]);
  await db.close();
  
  res.render('novoAgendamento', {
    clientes,
    funcionarios,
    procedimentos,
    msg: '' // <=== Adicione isso
  });
});


app.post('/novo-agendamento', requireLogin, async (req, res) => {
  let { nome, cpf, dia, horario, procedimento_id, funcionario_id } = req.body;
  const db = await abrirBanco();
  const empresaId = req.session.usuarioLogado.empresa_id;

  const procedimentos = await db.all('SELECT * FROM procedimentos WHERE empresa_id = ?', [empresaId]);
  const funcionarios = await db.all('SELECT * FROM funcionarios WHERE empresa_id = ?', [empresaId]);

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

  const funcionarioValido = funcionarios.some(f => f.id == funcionario_id);
  const procedimentoIdsValidos = procedimentos.map(p => String(p.id));
  const procedimentoInvalido = procedimento_id.some(pid => !procedimentoIdsValidos.includes(String(pid)));

  if (!funcionarioValido || procedimentoInvalido) {
    await db.close();
    return res.render('novoAgendamento', {
      procedimentos,
      funcionarios,
      msg: 'Funcionário ou procedimento inválido para esta empresa.'
    });
  }

  let cliente = await db.get('SELECT * FROM clientes WHERE cpf = ? AND empresa_id = ?', [cpfLimpo, empresaId]);
  if (!cliente) {
    await db.run('INSERT INTO clientes (nome, cpf, empresa_id) VALUES (?, ?, ?)', [nome, cpfLimpo, empresaId]);
    cliente = await db.get('SELECT * FROM clientes WHERE cpf = ? AND empresa_id = ?', [cpfLimpo, empresaId]);
  }

  await db.run(
    'INSERT INTO agendamentos (cliente_id, dia, horario, funcionario_id, empresa_id) VALUES (?, ?, ?, ?, ?)',
    [cliente.id, dia, horario, funcionario_id, empresaId]
  );

  const agendamento = await db.get('SELECT last_insert_rowid() as id');

  for (const pid of procedimento_id) {
    await db.run('INSERT INTO agendamento_procedimentos (agendamento_id, procedimento_id) VALUES (?, ?)', [agendamento.id, pid]);
  }

  await db.close();
  req.session.msg = 'Agendamento criado com sucesso!';
  res.redirect('/agendamentos');
});

app.post('/apagar-agendamento/:id', requireLogin, async (req, res) => {
  const db = await abrirBanco();
  const empresaId = req.session.usuarioLogado.empresa_id;
  const agendamentoId = req.params.id;

  // Garante que o agendamento pertence à empresa antes de excluir
  await db.run(`
    DELETE FROM agendamento_procedimentos
    WHERE agendamento_id IN (
      SELECT id FROM agendamentos WHERE id = ? AND empresa_id = ?
    )
  `, [agendamentoId, empresaId]);

  const result = await db.run(`
    DELETE FROM agendamentos
    WHERE id = ? AND empresa_id = ?
  `, [agendamentoId, empresaId]);

  await db.close();

  if (result.changes === 0) {
    req.session.msg = { tipo: 'erro', texto: 'Agendamento não encontrado ou pertence a outra empresa.' };
  } else {
    req.session.msg = { tipo: 'sucesso', texto: 'Agendamento removido com sucesso.' };
  }

  res.redirect('/agendamentos');
});


app.get('/funcionarios', requireLogin, async (req, res) => {
  const db = await abrirBanco();
  const empresaId = req.session.usuarioLogado.empresa_id;

  const funcionarios = await db.all(`
    SELECT f.id, f.nome, f.telefone, f.email,
           GROUP_CONCAT(e.nome, ', ') AS especialidades
    FROM funcionarios f
    LEFT JOIN funcionario_especialidades fe ON f.id = fe.funcionario_id
    LEFT JOIN especialidades e ON fe.especialidade_id = e.id AND e.empresa_id = ?
    WHERE f.empresa_id = ?
    GROUP BY f.id
  `, [empresaId, empresaId]);

  const especialidades = await db.all('SELECT * FROM especialidades WHERE empresa_id = ?', [empresaId]);

  await db.close();

  res.render('funcionarios', {
    funcionarios: funcionarios || [],
    especialidades: especialidades || [],
    msg: req.session.msg || null
  });

  delete req.session.msg;
});



app.post('/funcionarios', requireLogin, async (req, res) => {
  const { nome } = req.body;
  let especialidade_ids = req.body.especialidade_ids;
  const empresaId = req.session.usuarioLogado.empresa_id;

  if (!Array.isArray(especialidade_ids)) {
    especialidade_ids = especialidade_ids ? [especialidade_ids] : [];
  }

  const db = await abrirBanco();
  try {
    // Inserir funcionário (sem especialidade diretamente)
    const result = await db.run(
      'INSERT INTO funcionarios (nome, email, telefone, ativo, empresa_id) VALUES (?, ?, ?, ?, ?)',
      [nome, email, telefone, 1, empresaId]
    );
    
    const funcionarioId = result.lastID;

    // Inserir especialidades relacionadas
    for (const espId of especialidade_ids) {
      await db.run(
        'INSERT INTO funcionario_especialidades (funcionario_id, especialidade_id) VALUES (?, ?)',
        [funcionarioId, espId]
      );
    }

    req.session.msg = { tipo: 'sucesso', texto: 'Funcionário cadastrado com sucesso!' };
    res.redirect('/funcionarios');

  } catch (err) {
    const funcionarios = await db.all(`
      SELECT f.id, f.nome,
             GROUP_CONCAT(e.nome, ', ') AS especialidades
      FROM funcionarios f
      LEFT JOIN funcionario_especialidades fe ON f.id = fe.funcionario_id
      LEFT JOIN especialidades e ON fe.especialidade_id = e.id AND e.empresa_id = ?
      WHERE f.empresa_id = ?
      GROUP BY f.id
    `, [empresaId, empresaId]);

    const especialidades = await db.all('SELECT * FROM especialidades WHERE empresa_id = ?', [empresaId]);

    res.render('funcionarios', {
      funcionarios,
      especialidades,
      msg: { tipo: 'erro', texto: 'Erro ao cadastrar funcionário: ' + err.message }
    });

  } finally {
    await db.close();
  }
});
app.post('/funcionarios/:id/excluir', requireLogin, async (req, res) => {
  const db = await abrirBanco();
  const funcionarioId = req.params.id;
  const empresaId = req.session.usuarioLogado.empresa_id;

  try {
    // Verifica se o funcionário pertence à empresa
    const funcionario = await db.get(
      'SELECT * FROM funcionarios WHERE id = ? AND empresa_id = ?',
      [funcionarioId, empresaId]
    );

    if (!funcionario) {
      req.session.msg = { tipo: 'erro', texto: 'Funcionário não encontrado ou pertence a outra empresa.' };
    } else {
      // Remove vínculos com especialidades antes de excluir
      await db.run('DELETE FROM funcionario_especialidades WHERE funcionario_id = ?', [funcionarioId]);
      await db.run('DELETE FROM funcionarios WHERE id = ? AND empresa_id = ?', [funcionarioId, empresaId]);
      req.session.msg = { tipo: 'sucesso', texto: 'Funcionário excluído com sucesso!' };
    }

    res.redirect('/funcionarios');

  } catch (err) {
    req.session.msg = { tipo: 'erro', texto: 'Erro ao excluir funcionário: ' + err.message };
    res.redirect('/funcionarios');
  } finally {
    await db.close();
  }
});

// NOVA ROTA: horários ocupados para AJAX
app.get('/horarios-ocupados', requireLogin, async (req, res) => {
  const { funcionario_id, dia } = req.query;
  const empresaId = req.session.usuarioLogado.empresa_id;

  if (!funcionario_id || !dia) return res.json([]);

  try {
    const db = await abrirBanco();
    const horarios = await db.all(
      `SELECT horario FROM agendamentos 
       WHERE funcionario_id = ? AND dia = ? AND empresa_id = ?`,
      [funcionario_id, dia, empresaId]
    );
    await db.close();

    const ocupados = horarios.map(h => h.horario);
    res.json(ocupados);

  } catch (error) {
    console.error(error);
    res.status(500).json([]);
  }
});

app.get('/horarios-disponiveis', requireLogin, async (req, res) => {
  const { funcionario_id, dia, procedimentos } = req.query;

  const empresaId = req.session.usuarioLogado.empresa_id;

  if (!funcionario_id || !dia || !procedimentos) {
    return res.status(400).json({ erro: 'Dados incompletos.' });
  }

  const procedimentosIds = Array.isArray(procedimentos) ? procedimentos : [procedimentos];

  const db = await abrirBanco();

  try {
    const diasSemana = ['domingo', 'segunda', 'terca', 'quarta', 'quinta', 'sexta', 'sabado'];
    const nomeDiaSemana = diasSemana[new Date(dia).getDay()];

    // Buscar expediente
    const expediente = await db.get(`
      SELECT inicio, fim FROM horarios_expeds
      WHERE funcionario_id = ? AND dia_semana = ?
    `, [funcionario_id, nomeDiaSemana]);

    if (!expediente || !expediente.inicio || !expediente.fim) {
      await db.close();
      return res.json({ horarios: [], ocupados: [] });
    }

    // Buscar agendamentos ocupados
    const agendamentos = await db.all(`
      SELECT a.horario, IFNULL(SUM(p.duracao), 0) as duracaoTotal
      FROM agendamentos a
      LEFT JOIN agendamento_procedimentos ap ON ap.agendamento_id = a.id
      LEFT JOIN procedimentos p ON p.id = ap.procedimento_id AND p.empresa_id = ?
      WHERE a.funcionario_id = ? AND a.dia = ? AND a.empresa_id = ?
      GROUP BY a.id
    `, [empresaId, funcionario_id, dia, empresaId]);

    const horariosOcupados = [];

    agendamentos.forEach(ag => {
      let inicio = dayjs(`${dia}T${ag.horario}`);
      const duracaoComIntervalo = ag.duracaoTotal + 10;
      const fim = inicio.add(duracaoComIntervalo, 'minute');

      while (inicio.isBefore(fim)) {
        horariosOcupados.push(inicio.format('HH:mm'));
        inicio = inicio.add(10, 'minute');
      }
    });

    // Calcular duração total dos procedimentos selecionados
    const placeholders = procedimentosIds.map(() => '?').join(',');
    const total = await db.get(`
      SELECT SUM(duracao) as duracaoTotal
      FROM procedimentos
      WHERE id IN (${placeholders}) AND empresa_id = ?
    `, [...procedimentosIds, empresaId]);

    const duracaoTotalComIntervalo = (total?.duracaoTotal || 0) + 10;

    // Gerar horários disponíveis
    const horarios = [];
    let horaAtual = dayjs(`${dia}T${expediente.inicio}`);
    const horaFim = dayjs(`${dia}T${expediente.fim}`);

    while (horaAtual.add(duracaoTotalComIntervalo, 'minute').isSameOrBefore(horaFim)) {
      const horarioTexto = horaAtual.format('HH:mm');
      let podeAgendar = true;
      let simulacao = horaAtual.clone();

      for (let i = 0; i < duracaoTotalComIntervalo; i += 10) {
        if (horariosOcupados.includes(simulacao.format('HH:mm'))) {
          podeAgendar = false;
          break;
        }
        simulacao = simulacao.add(10, 'minute');
      }

      horarios.push({
        horario: horarioTexto,
        ocupado: !podeAgendar
      });

      horaAtual = horaAtual.add(10, 'minute');
    }

    await db.close();
    res.json(horarios);

  } catch (error) {
    console.error('Erro ao carregar horários:', error);
    await db.close();
    res.status(500).json({ erro: 'Erro interno ao buscar horários' });
  }
});
app.get('/editar-agendamento/:id', requireLogin, async (req, res) => {
  const id = req.params.id;
  const empresaId = req.session.usuarioLogado.empresa_id;
  const db = await abrirBanco();

  // Filtra o agendamento pela empresa
  const agendamento = await db.get(`
      SELECT * FROM agendamentos 
      WHERE id = ? AND empresa_id = ?
  `, [id, empresaId]);

  if (!agendamento) {
      await db.close();
      return res.status(404).send('Agendamento não encontrado ou pertence a outra empresa.');
  }

  const clientes = await db.all('SELECT * FROM clientes WHERE empresa_id = ?', [empresaId]);

  const procedimentosSelecionados = await db.all(`
      SELECT procedimento_id FROM agendamento_procedimentos WHERE agendamento_id = ?
  `, [id]);

  const procedimentos = await db.all('SELECT * FROM procedimentos WHERE empresa_id = ?', [empresaId]);

  const funcionarios = await db.all('SELECT * FROM funcionarios WHERE empresa_id = ?', [empresaId]);

  await db.close();

  const procedimentoIds = procedimentosSelecionados.map(p => p.procedimento_id);

  res.render('editarAgendamento', {
      agendamento,
      clientes,
      procedimentos,
      funcionarios,
      procedimentoIds,
      msg: null
  });
});
app.post('/editar-agendamento/:id', requireLogin, async (req, res) => {
  const id = req.params.id;
  let { nome, cpf, dia, horario, funcionario_id, procedimento_id } = req.body;
  const empresaId = req.session.usuarioLogado.empresa_id;
  const db = await abrirBanco();

  const procedimentos = await db.all('SELECT * FROM procedimentos WHERE empresa_id = ?', [empresaId]);
  const funcionarios = await db.all('SELECT * FROM funcionarios WHERE empresa_id = ?', [empresaId]);

  if (!Array.isArray(procedimento_id)) procedimento_id = [procedimento_id];
  procedimento_id = procedimento_id.filter(p => p !== '');

  const cpfLimpo = cpf.replace(/\D/g, '');

  if (!funcionario_id || cpfLimpo.length !== 11 || procedimento_id.length === 0) {
    await db.close();
    return res.render('editarAgendamento', {
      agendamento: { id, nome, cpf, dia, horario, funcionario_id },
      procedimentos,
      funcionarios,
      procedimentoIds: procedimento_id.map(Number),
      msg: 'Dados inválidos. Verifique todos os campos.'
    });
  }

  // ⚠️ Verificar se o agendamento pertence à empresa
  const agendamento = await db.get('SELECT * FROM agendamentos WHERE id = ? AND empresa_id = ?', [id, empresaId]);
  if (!agendamento) {
    await db.close();
    return res.status(403).send('Agendamento não encontrado ou pertence a outra empresa.');
  }

  // Verifica se há conflito de horário
  const conflito = await db.get(`
    SELECT * FROM agendamentos
    WHERE dia = ? AND horario = ? AND funcionario_id = ? AND id != ? AND empresa_id = ?
  `, [dia, horario, funcionario_id, id, empresaId]);

  if (conflito) {
    await db.close();
    return res.render('editarAgendamento', {
      agendamento: { id, nome, cpf, dia, horario, funcionario_id },
      procedimentos,
      funcionarios,
      procedimentoIds: procedimento_id.map(Number),
      msg: 'Já existe um agendamento neste horário com esse funcionário.'
    });
  }

  // Inserir ou obter cliente
  let cliente = await db.get('SELECT * FROM clientes WHERE cpf = ? AND empresa_id = ?', [cpfLimpo, empresaId]);
  if (!cliente) {
    await db.run(
      'INSERT INTO clientes (nome, cpf, empresa_id) VALUES (?, ?, ?)',
      [nome, cpfLimpo, empresaId]
    );
    cliente = await db.get('SELECT * FROM clientes WHERE cpf = ? AND empresa_id = ?', [cpfLimpo, empresaId]);
  }

  // Atualizar agendamento
  await db.run(`
    UPDATE agendamentos
    SET cliente_id = ?, dia = ?, horario = ?, funcionario_id = ?
    WHERE id = ? AND empresa_id = ?
  `, [cliente.id, dia, horario, funcionario_id, id, empresaId]);

  // Apagar procedimentos antigos
  await db.run(`
    DELETE FROM agendamento_procedimentos 
    WHERE agendamento_id IN (
      SELECT id FROM agendamentos WHERE id = ? AND empresa_id = ?
    )
  `, [id, empresaId]);

  // Inserir novos procedimentos
  for (const pid of procedimento_id) {
    await db.run(
      'INSERT INTO agendamento_procedimentos (agendamento_id, procedimento_id) VALUES (?, ?)',
      [id, pid]
    );
  }

  await db.close();
  req.session.msg = 'Agendamento atualizado com sucesso!';
  res.redirect('/agendamentos');
});

app.post('/excluir-funcionario/:id', requireLogin, async (req, res) => {
  const id = req.params.id;
  const empresaId = req.session.usuarioLogado.empresa_id;
  const db = await abrirBanco();

  try {
    // Garante que o funcionário pertence à empresa
    const funcionario = await db.get('SELECT * FROM funcionarios WHERE id = ? AND empresa_id = ?', [id, empresaId]);

    if (!funcionario) {
      await db.close();
      req.session.msg = 'Funcionário não encontrado ou pertence a outra empresa.';
      return res.redirect('/funcionarios');
    }

    // Deleta vínculos e depois o funcionário
    await db.run('DELETE FROM funcionario_especialidades WHERE funcionario_id = ?', [id]);
    await db.run('DELETE FROM funcionarios WHERE id = ? AND empresa_id = ?', [id, empresaId]);

    req.session.msg = 'Funcionário excluído com sucesso!';
  } catch (err) {
    console.error('Erro ao excluir funcionário:', err.message);
    req.session.msg = 'Erro ao excluir funcionário.';
  } finally {
    await db.close();
    res.redirect('/funcionarios');
  }
});
app.get('/editar-funcionario/:id', requireLogin, async (req, res) => {
  const db = await abrirBanco();
  const id = req.params.id;
  const empresaId = req.session.usuarioLogado.empresa_id;

  // Garante que o funcionário pertence à empresa
  const funcionario = await db.get('SELECT * FROM funcionarios WHERE id = ? AND empresa_id = ?', [id, empresaId]);

  if (!funcionario) {
    await db.close();
    req.session.msg = 'Funcionário não encontrado ou pertence a outra empresa.';
    return res.redirect('/funcionarios');
  }

  const especialidades = await db.all(
    'SELECT * FROM especialidades WHERE empresa_id = ?',
    [empresaId]
  );

  const vinculos = await db.all(
    'SELECT especialidade_id FROM funcionario_especialidades WHERE funcionario_id = ?',
    [id]
  );

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
  const empresaId = req.session.usuarioLogado.empresa_id;

  const db = await abrirBanco();

  // Verifica se o funcionário pertence à empresa
  const funcionario = await db.get('SELECT * FROM funcionarios WHERE id = ? AND empresa_id = ?', [id, empresaId]);
  if (!funcionario) {
    await db.close();
    req.session.msg = 'Funcionário não encontrado ou pertence a outra empresa.';
    return res.redirect('/funcionarios');
  }

  // Atualiza nome
  await db.run(
    'UPDATE funcionarios SET nome = ? WHERE id = ? AND empresa_id = ?',
    [nome, id, empresaId]
  );

  // Remove especialidades antigas
  await db.run(`
    DELETE FROM funcionario_especialidades
    WHERE funcionario_id = ?
  `, [id]);

  // Adiciona novas especialidades
  const lista = Array.isArray(especialidade_ids) ? especialidade_ids : [especialidade_ids];
  for (const espId of lista.filter(Boolean)) {
    await db.run(
      'INSERT INTO funcionario_especialidades (funcionario_id, especialidade_id) VALUES (?, ?)',
      [id, espId]
    );
  }

  await db.close();
  req.session.msg = 'Funcionário atualizado com sucesso!';
  res.redirect('/funcionarios');
});

app.get('/horarios-funcionario/:id', requireLogin, async (req, res) => {
  const db = await abrirBanco();
  const empresaId = req.session.usuarioLogado.empresa_id;

  // Garante que o funcionário pertence à empresa
  const funcionario = await db.get(
    'SELECT * FROM funcionarios WHERE id = ? AND empresa_id = ?',
    [req.params.id, empresaId]
  );

  if (!funcionario) {
    await db.close();
    return res.status(404).send('Funcionário não encontrado ou não pertence à sua empresa.');
  }

  const horarios = await db.all(
    'SELECT * FROM horarios_funcionarios WHERE funcionario_id = ? ORDER BY dia_semana, horario',
    [req.params.id]
  );

  await db.close();

  res.render('horariosFuncionario', {
    funcionario,
    horarios
  });
});
app.post('/horarios-funcionario/:id/adicionar', requireLogin, async (req, res) => {
  const { dia_semana, horario } = req.body;
  const funcionario_id = req.params.id;
  const empresaId = req.session.usuarioLogado.empresa_id;

  const db = await abrirBanco();

  // Verifica se o funcionário pertence à empresa logada
  const funcionario = await db.get(
    'SELECT * FROM funcionarios WHERE id = ? AND empresa_id = ?',
    [funcionario_id, empresaId]
  );

  if (!funcionario) {
    await db.close();
    return res.status(403).send('Funcionário não pertence à sua empresa.');
  }

  // Insere horário
  await db.run(
    'INSERT INTO horarios_funcionarios (funcionario_id, dia_semana, horario) VALUES (?, ?, ?)',
    [funcionario_id, dia_semana, horario]
  );

  await db.close();
  res.redirect(`/horarios-funcionario/${funcionario_id}`);
});

app.post('/horarios-funcionario/:id/remover/:horarioId', requireLogin, async (req, res) => {
  const db = await abrirBanco();
  const empresaId = req.session.usuarioLogado.empresa_id;
  const funcionarioId = req.params.id;
  const horarioId = req.params.horarioId;

  // Garante que o horário pertence a um funcionário da empresa
  const horario = await db.get(`
    SELECT hf.id
    FROM horarios_funcionarios hf
    JOIN funcionarios f ON f.id = hf.funcionario_id
    WHERE hf.id = ? AND f.empresa_id = ?
  `, [horarioId, empresaId]);

  if (!horario) {
    await db.close();
    return res.status(403).send('Horário não encontrado ou não pertence à sua empresa.');
  }

  await db.run('DELETE FROM horarios_funcionarios WHERE id = ?', [horarioId]);
  await db.close();
  res.redirect(`/horarios-funcionario/${funcionarioId}`);
});

        // Redireciona para a página de horários do funcionário selecionado
        app.get('/expediente-funcionario/:id', requireLogin, async (req, res) => {
          const db = await abrirBanco();
          const empresaId = req.session.usuarioLogado.empresa_id;
          const funcionarioId = req.params.id;
        
          const funcionario = await db.get(
            'SELECT * FROM funcionarios WHERE id = ? AND empresa_id = ?',
            [funcionarioId, empresaId]
          );
        
          if (!funcionario) {
            await db.close();
            return res.status(404).send('Funcionário não encontrado ou não pertence à sua empresa.');
          }
        
          const registros = await db.all(`
            SELECT dia_semana, inicio, fim
            FROM horarios_expeds
            WHERE funcionario_id = ?
          `, [funcionarioId]);
        
          const expediente = {};
          registros.forEach(r => {
            expediente[r.dia_semana] = { inicio: r.inicio, fim: r.fim };
          });
        
          await db.close();
        
          const sucesso = req.query.sucesso === '1';
        
          res.render('expedienteFuncionario', {
            funcionario,
            expediente,
            sucesso
          });
        });
        
        app.post('/expediente-funcionario/:id', requireLogin, async (req, res) => {
          const funcionarioId = req.params.id;
          const empresaId = req.session.usuarioLogado.empresa_id;
          const db = await abrirBanco();
        
          const diasSemana = ['domingo', 'segunda', 'terca', 'quarta', 'quinta', 'sexta', 'sabado'];
        
          try {
            // Garante que o funcionário pertence à empresa logada
            const funcionario = await db.get(
              'SELECT * FROM funcionarios WHERE id = ? AND empresa_id = ?',
              [funcionarioId, empresaId]
            );
        
            if (!funcionario) {
              await db.close();
              return res.status(403).send('Funcionário não encontrado ou não pertence à sua empresa.');
            }
        
            // Remove os expedientes antigos apenas se o vínculo com empresa existir
            await db.run(`
              DELETE FROM horarios_expeds
              WHERE funcionario_id = ?
            `, [funcionarioId]);
        
            // Reinsere os horários informados
            for (const dia of diasSemana) {
              if (req.body[`ativo_${dia}`]) {
                const inicio = req.body[`inicio_${dia}`];
                const fim = req.body[`fim_${dia}`];
        
                if (inicio && fim) {
                  await db.run(`
                    INSERT INTO horarios_expeds (funcionario_id, dia_semana, inicio, fim)
                    VALUES (?, ?, ?, ?)
                  `, [funcionarioId, dia, inicio, fim]);
                }
              }
            }
        
            await db.close();
            res.redirect(`/expediente-funcionario/${funcionarioId}?sucesso=1`);
        
          } catch (error) {
            console.error('Erro ao salvar expediente:', error);
            await db.close();
            res.status(500).send('Erro ao salvar expediente.');
          }
        });
        app.get('/corrigir-expediente', requireLogin, async (req, res) => {
          console.log("⚙️ Rota /corrigir-expediente foi chamada!");
        
          const db = await abrirBanco();
          const empresaId = req.session.usuarioLogado.empresa_id;
        
          const mapaDias = {
            'Domingo': 'domingo',
            'Segunda': 'segunda',
            'Segunda-feira': 'segunda',
            'Terça': 'terca',
            'Terça-feira': 'terca',
            'Quarta': 'quarta',
            'Quarta-feira': 'quarta',
            'Quinta': 'quinta',
            'Quinta-feira': 'quinta',
            'Sexta': 'sexta',
            'Sexta-feira': 'sexta',
            'Sábado': 'sabado',
            'Sabado': 'sabado'
          };
        
          for (const original in mapaDias) {
            const corrigido = mapaDias[original];
            await db.run(`
              UPDATE horarios_expeds
              SET dia_semana = ?
              WHERE LOWER(dia_semana) = ? AND funcionario_id IN (
                SELECT id FROM funcionarios WHERE empresa_id = ?
              )
            `, [corrigido, original.toLowerCase(), empresaId]);
          }
        
          await db.close();
          res.send('Expediente corrigido com sucesso!');
        });

        app.get('/corrigir-duracoes', requireLogin, async (req, res) => {
          const db = await abrirBanco();
          const empresaId = req.session.usuarioLogado.empresa_id;
        
          const duracoes = {
            'Corte Feminino': 60,
            'Corte Masculino': 45,
            'Escova': 40,
            'Manicure': 30,
            'Pedicure': 30
          };
        
          for (const nome in duracoes) {
            const duracao = duracoes[nome];
            await db.run(
              `UPDATE procedimentos SET duracao = ? WHERE nome = ? AND empresa_id = ?`,
              [duracao, nome, empresaId]
            );
          }
        
          await db.close();
          res.send('Durações corrigidas com sucesso!');
        });
        

app.get('/procedimentos', requireLogin, async (req, res) => {
  try {
    const empresaId = req.session.usuarioLogado?.empresa_id;

    if (!empresaId) {
      return res.redirect('/login'); // segurança extra
    }

    const procedimentos = await listarProcedimentos(empresaId); // usa a função reutilizável

 const msg = req.session.msg || null;
delete req.session.msg;

res.render('procedimentos', {
  procedimentos,
  msg: msg ? { tipo: 'sucesso', texto: msg } : null
});

  } catch (error) {
    console.error('Erro ao listar procedimentos:', error);
    res.status(500).send('Erro ao carregar procedimentos');
  }
});


          app.post('/procedimentos', requireLogin, async (req, res) => {
            const db = await abrirBanco();
          
            try {
              const empresaId = req.session.usuarioLogado.empresa_id;
          
              for (const key in req.body) {
                if (key.startsWith('duracao_') || key.startsWith('valor_')) {
                  const id = key.split('_')[1];
                  const duracao = req.body[`duracao_${id}`];
                  const valor = req.body[`valor_${id}`];
              
                  if (duracao && valor && duracao > 0 && valor >= 0) {
                    await db.run(
                      'UPDATE procedimentos SET duracao = ?, valor = ? WHERE id = ? AND empresa_id = ?',
                      [duracao, valor, id, empresaId]
                    );
                  }
                }
              }
          
              await db.close();
              res.redirect('/procedimentos?sucesso=editado');
            } catch (error) {
              await db.close();
              res.send('Erro ao atualizar procedimentos: ' + error.message);
            }
          });
          
            
          app.get('/novo-funcionario', requireLogin, async (req, res) => {
            const db = await abrirBanco();
            const empresaId = req.session.usuarioLogado.empresa_id;
          
            const especialidades = await db.all(
              'SELECT * FROM especialidades WHERE empresa_id = ?',
              [empresaId]
            );
          
            await db.close();
          
            res.render('novoFuncionario', {
              especialidades,
              msg: null
            });
          });
          

          app.post('/novo-funcionario', requireLogin, async (req, res) => {
            let { nome, email, telefone, especialidade_ids } = req.body;
            const empresaId = req.session.usuarioLogado.empresa_id;
          
            // Remove máscara do telefone e limita a 11 dígitos
            telefone = telefone?.replace(/\D/g, '').substring(0, 11);
          
            // Validação
            if (!nome || !email || !telefone || telefone.length !== 11) {
              const db = await abrirBanco();
              const especialidades = await db.all('SELECT * FROM especialidades WHERE empresa_id = ?', [empresaId]);
              await db.close();
          
              return res.render('novoFuncionario', {
                especialidades,
                msg: 'Preencha todos os campos corretamente. O telefone deve conter 11 dígitos numéricos.'
              });
            }
          
            const db = await abrirBanco();
            try {
              // Inserir funcionário
              const result = await db.run(
                'INSERT INTO funcionarios (nome, email, telefone, empresa_id) VALUES (?, ?, ?, ?)',
                [nome, email, telefone, empresaId]
              );
          
              const funcionarioId = result.lastID;
          
              // Inserir especialidades (única ou múltiplas)
              if (especialidade_ids) {
                const lista = Array.isArray(especialidade_ids) ? especialidade_ids : [especialidade_ids];
                for (const espId of lista.filter(Boolean)) {
                  await db.run(
                    'INSERT INTO funcionario_especialidades (funcionario_id, especialidade_id) VALUES (?, ?)',
                    [funcionarioId, espId]
                  );
                }
              }
          
              req.session.msg = 'Funcionário cadastrado com sucesso!';
              res.redirect('/funcionarios');
            } catch (err) {
              const especialidades = await db.all('SELECT * FROM especialidades WHERE empresa_id = ?', [empresaId]);
              res.render('novoFuncionario', {
                especialidades,
                msg: 'Erro ao cadastrar funcionário: ' + err.message
              });
            } finally {
              await db.close();
            }
          });
          
      app.post('/nova-especialidade', requireLogin, async (req, res) => {
        const { nome } = req.body;
        const empresaId = req.session.usuarioLogado.empresa_id;
        const db = await abrirBanco();
      
        try {
          await db.run(
            'INSERT INTO especialidades (nome, empresa_id) VALUES (?, ?)',
            [nome, empresaId]
          );
          req.session.msg = 'Especialidade cadastrada com sucesso!';
        } catch (error) {
          req.session.msg = 'Erro ao cadastrar especialidade: ' + error.message;
        }
      
        await db.close();
        res.redirect('/especialidades');
      });
      
      app.get('/editar-especialidade/:id', requireLogin, async (req, res) => {
        const db = await abrirBanco();
        const empresaId = req.session.usuarioLogado.empresa_id;
      
        const especialidade = await db.get(
          'SELECT * FROM especialidades WHERE id = ? AND empresa_id = ?',
          [req.params.id, empresaId]
        );
      
        await db.close();
      
        if (!especialidade) {
          return res.status(403).send('Especialidade não encontrada ou não pertence à sua empresa.');
        }
      
        res.render('editarEspecialidade', { especialidade });
      });
      
      app.get('/relatorios', requireLogin, async (req, res) => {
        const db = await abrirBanco();
        const empresaId = req.session.usuarioLogado.empresa_id;
      
        const {
          filtro,
          valorTexto,
          valorProcedimento,
          valorFuncionario,
          valorMin,
          valorMax,
          valorMinGlobal,
          valorMaxGlobal,
          dataInicio,
          dataFim,
          pagina = 1
        } = req.query;
      
        const itensPorPagina = 10;
        const offset = (pagina - 1) * itensPorPagina;
      
        let whereClauses = [];
        let params = [];
      
        // Filtros
        if (filtro) {
          if (filtro === 'nome') {
            whereClauses.push('c.nome LIKE ?');
            params.push(`%${valorTexto}%`);
          } else if (filtro === 'cpf') {
            whereClauses.push('c.cpf LIKE ?');
            params.push(`%${valorTexto.replace(/\D/g, '')}%`);
          } else if (filtro === 'procedimento') {
            whereClauses.push(`a.id IN (
              SELECT agendamento_id FROM agendamento_procedimentos WHERE procedimento_id = ?
            )`);
            params.push(valorProcedimento);
          } else if (filtro === 'funcionario') {
            whereClauses.push('a.funcionario_id = ?');
            params.push(valorFuncionario);
          } else if (filtro === 'valor') {
            if (valorMin) {
              whereClauses.push(`(
                SELECT SUM(p.valor)
                FROM agendamento_procedimentos ap
                JOIN procedimentos p ON ap.procedimento_id = p.id
                WHERE ap.agendamento_id = a.id
              ) >= ?`);
              params.push(valorMin);
            }
            if (valorMax) {
              whereClauses.push(`(
                SELECT SUM(p.valor)
                FROM agendamento_procedimentos ap
                JOIN procedimentos p ON ap.procedimento_id = p.id
                WHERE ap.agendamento_id = a.id
              ) <= ?`);
              params.push(valorMax);
            }
          } else if (filtro === 'data') {
            if (dataInicio) {
              whereClauses.push('a.dia >= ?');
              params.push(dataInicio);
            }
            if (dataFim) {
              whereClauses.push('a.dia <= ?');
              params.push(dataFim);
            }
          }
        }
      
        // Filtro fixo: apenas finalizados
        whereClauses.push('a.finalizado = 1');
      
        // Cláusula WHERE com empresa_id incluído no final
        const where = whereClauses.length
          ? `WHERE ${whereClauses.join(' AND ')} AND a.empresa_id = ?`
          : `WHERE a.empresa_id = ?`;
      
        // 1) Total de registros para paginação
        const totalAgendamentosRow = await db.get(`
          SELECT COUNT(DISTINCT a.id) AS total
          FROM agendamentos a
          JOIN clientes c ON a.cliente_id = c.id AND c.empresa_id = ?
          LEFT JOIN funcionarios f ON a.funcionario_id = f.id AND f.empresa_id = ?
          LEFT JOIN agendamento_procedimentos ap ON ap.agendamento_id = a.id
          LEFT JOIN procedimentos p ON p.id = ap.procedimento_id AND p.empresa_id = ?
          ${where}
        `, [empresaId, empresaId, empresaId, ...params, empresaId]);
      
        const totalAgendamentos = totalAgendamentosRow.total || 0;
        const temProximaPagina = (pagina * itensPorPagina) < totalAgendamentos;
      
        // 2) Agendamentos paginados
        const agendamentos = await db.all(`
          SELECT 
            a.id,
            c.nome AS cliente_nome,
            f.nome AS funcionario_nome,
            a.dia,
            a.horario,
            SUM(p.valor) as valor_total
          FROM agendamentos a
          JOIN clientes c ON a.cliente_id = c.id AND c.empresa_id = ?
          LEFT JOIN funcionarios f ON a.funcionario_id = f.id AND f.empresa_id = ?
          LEFT JOIN agendamento_procedimentos ap ON ap.agendamento_id = a.id
          LEFT JOIN procedimentos p ON p.id = ap.procedimento_id AND p.empresa_id = ?
          ${where}
          GROUP BY a.id
          ORDER BY a.dia ASC, a.horario ASC
          LIMIT ${itensPorPagina} OFFSET ${offset}
        `, [empresaId, empresaId, empresaId, ...params, empresaId]);
      
        const procedimentos = await db.all('SELECT * FROM procedimentos WHERE empresa_id = ?', [empresaId]);
        const funcionarios = await db.all('SELECT * FROM funcionarios WHERE empresa_id = ?', [empresaId]);
      
        await db.close();
      
        res.render('relatorios', {
          agendamentos,
          procedimentos,
          funcionarios,
          filtros: req.query,
          filtro: filtro || '',
          valorTexto: valorTexto || '',
          valorProcedimento: valorProcedimento || '',
          valorFuncionario: valorFuncionario || '',
          valorMin: valorMin || '',
          valorMax: valorMax || '',
          valorMinGlobal: valorMinGlobal || '',
          valorMaxGlobal: valorMaxGlobal || '',
          dataInicio: dataInicio || '',
          dataFim: dataFim || '',
          paginaAtual: parseInt(pagina),
          temProximaPagina
        });
      });
      
    

      app.get('/relatorios/pdf', requireLogin, async (req, res) => {
        const db = await abrirBanco();
      
        const { dataInicio, dataFim, funcionario_id, procedimento_id } = req.query;
        const empresaId = req.session.usuarioLogado.empresa_id;
      
        const whereClauses = ['a.empresa_id = ?']; // sempre inclui empresa
        const params = [empresaId, empresaId, empresaId, empresaId]; // para JOINs + filtro final
      
        if (dataInicio) {
          whereClauses.push('a.dia >= ?');
          params.push(dataInicio);
        }
      
        if (dataFim) {
          whereClauses.push('a.dia <= ?');
          params.push(dataFim);
        }
      
        if (funcionario_id) {
          whereClauses.push('a.funcionario_id = ?');
          params.push(funcionario_id);
        }
      
        if (procedimento_id) {
          whereClauses.push(`a.id IN (
            SELECT agendamento_id FROM agendamento_procedimentos WHERE procedimento_id = ?
          )`);
          params.push(procedimento_id);
        }
      
        const where = 'WHERE ' + whereClauses.join(' AND ');
      
        const sql = `
          SELECT 
            a.id,
            a.dia,
            a.horario,
            c.nome AS cliente_nome,
            f.nome AS funcionario_nome,
            IFNULL(SUM(p.valor), 0) AS valor_total
          FROM agendamentos a
          JOIN clientes c ON c.id = a.cliente_id AND c.empresa_id = ?
          JOIN funcionarios f ON f.id = a.funcionario_id AND f.empresa_id = ?
          LEFT JOIN agendamento_procedimentos ap ON ap.agendamento_id = a.id
          LEFT JOIN procedimentos p ON p.id = ap.procedimento_id AND p.empresa_id = ?
          ${where}
          GROUP BY a.id
          ORDER BY a.dia, a.horario
        `;
      
        const agendamentos = await db.all(sql, params);
        await db.close();
      
        if (!agendamentos.length) {
          return res.send('Nenhum agendamento encontrado para gerar o PDF.');
        }
      
        // Criar o documento PDF
        const doc = new PDFDocument();
        res.setHeader('Content-disposition', 'attachment; filename="relatorio-agendamentos.pdf"');
        res.setHeader('Content-type', 'application/pdf');
        doc.pipe(res);
      
        // Cabeçalho
        doc.fontSize(20).text('Relatório de Agendamentos', { align: 'center' });
        doc.moveDown();
      
        agendamentos.forEach((a, idx) => {
          doc.fontSize(12).text(`Cliente: ${a.cliente_nome}`);
          doc.text(`Funcionário: ${a.funcionario_nome}`);
          doc.text(`Data: ${a.dia}`);
          doc.text(`Horário: ${a.horario}`);
          doc.text(`Valor Total: R$ ${parseFloat(a.valor_total || 0).toFixed(2)}`);
          doc.moveDown();
          if (idx !== agendamentos.length - 1) doc.moveDown();
        });
      
        const valorTotalGeral = agendamentos.reduce((acc, a) => acc + (a.valor_total || 0), 0);
      
        doc.moveDown(2);
        doc.fontSize(14).text('Resumo Financeiro', { underline: true });
        doc.moveDown();
        doc.fontSize(12).text(`Total de agendamentos: ${agendamentos.length}`);
        doc.text(`Valor total: R$ ${valorTotalGeral.toFixed(2)}`);
      
        doc.end();
      });

app.post('/agendamentos/finalizar/:id', requireLogin, async (req, res) => {
  const db = await abrirBanco();
  const id = req.params.id;
  const empresaId = req.session.usuarioLogado.empresa_id;

  try {
    const result = await db.run(
      'UPDATE agendamentos SET finalizado = 1 WHERE id = ? AND empresa_id = ?',
      [id, empresaId]
    );

    if (result.changes === 0) {
      return res.json({ success: false, message: 'Agendamento não encontrado ou pertence a outra empresa.' });
    }

    res.json({ success: true });
  } catch (error) {
    console.error('Erro ao finalizar agendamento:', error.message);
    res.json({ success: false, message: 'Erro interno ao finalizar agendamento.' });
  } finally {
    await db.close();
  }
});

app.get('/escolherHorarioFuncionario', requireLogin, async (req, res) => {
  const { dia, funcionario_id } = req.query;
  const empresaId = req.session.usuarioLogado.empresa_id;

  if (!dia || !funcionario_id) {
    return res.status(400).json({ error: 'Parâmetros dia e funcionario_id são obrigatórios.' });
  }

  const db = await abrirBanco();

  const diasSemana = ['domingo', 'segunda', 'terca', 'quarta', 'quinta', 'sexta', 'sabado'];
  const diaSemana = diasSemana[new Date(dia).getDay()];

  try {
    // Verifica se o funcionário pertence à empresa
    const funcionario = await db.get(
      'SELECT id FROM funcionarios WHERE id = ? AND empresa_id = ?',
      [funcionario_id, empresaId]
    );

    if (!funcionario) {
      return res.status(403).json({ error: 'Funcionário não encontrado ou não pertence à sua empresa.' });
    }

    const expediente = await db.get(`
      SELECT inicio, fim
      FROM horarios_expeds
      WHERE funcionario_id = ? AND dia_semana = ?
    `, [funcionario_id, diaSemana]);

    res.json({ expediente });
  } catch (error) {
    console.error('Erro ao buscar expediente:', error);
    res.status(500).json({ error: 'Erro interno ao buscar expediente.' });
  } finally {
    await db.close();
  }
});
app.post('/excluir-especialidade/:id', requireLogin, async (req, res) => {
  const db = await abrirBanco();
  const id = req.params.id;
  const empresaId = req.session.usuarioLogado.empresa_id;

  try {
    const result = await db.run(
      'DELETE FROM especialidades WHERE id = ? AND empresa_id = ?',
      [id, empresaId]
    );

    req.session.msg = {
      tipo: result.changes === 0 ? 'erro' : 'sucesso',
      texto: result.changes === 0 
        ? 'Especialidade não encontrada ou pertence a outra empresa.'
        : 'Especialidade excluída com sucesso.'
    };

    res.redirect('/especialidades');
  } catch (error) {
    console.error('Erro ao excluir especialidade:', error.message);
    req.session.msg = {
      tipo: 'erro',
      texto: 'Erro ao excluir especialidade.'
    };
    res.redirect('/especialidades');
  } finally {
    await db.close();
  }
});
// Listar procedimentos com feedback de sessão
app.get('/procedimentos', requireLogin, async (req, res) => {
  try {
    const usuario = req.session.usuarioLogado;

    if (!usuario || !usuario.empresa_id) {
      return res.redirect('/login');
    }

    const empresaId = usuario.empresa_id;
    console.log('Empresa logada:', empresaId);

    const procedimentos = await listarProcedimentos(empresaId);

    const msg = req.session.msg || null;
    delete req.session.msg;

    res.render('procedimentos', {
      procedimentos,
      msg: msg ? { tipo: 'sucesso', texto: msg } : null
    });

  } catch (error) {
    console.error('Erro ao listar procedimentos:', error);
    res.status(500).send('Erro ao carregar procedimentos');
  }
});

// Página de criação de novo procedimento
app.get('/novo-procedimento', requireLogin, (req, res) => {
  res.render('novoProcedimento', { msg: null });
});

// Inserção de novo procedimento
app.post('/novo-procedimento', requireLogin, async (req, res) => {
  const { nome, valor, duracao } = req.body;
  const empresaId = req.session.usuarioLogado.empresa_id;
  const db = await abrirBanco();

  try {
    if (!nome || !valor || !duracao) {
      req.session.msg = 'Todos os campos são obrigatórios.';
      return res.redirect('/novo-procedimento');
    }

    await db.run(
      'INSERT INTO procedimentos (nome, valor, duracao, empresa_id) VALUES (?, ?, ?, ?)',
      [nome, valor, duracao, empresaId]
    );

    req.session.msg = 'Procedimento cadastrado com sucesso!';
    res.redirect('/procedimentos');
  } catch (error) {
    console.error('Erro ao inserir procedimento:', error.message);
    req.session.msg = 'Erro ao cadastrar procedimento.';
    res.redirect('/novo-procedimento');
  } finally {
    await db.close();
  }
});

// Exibir formulário para editar procedimentos (tela de edição em massa)
// Rota para exibir tela de edição de procedimentos
app.get('/editar-procedimento', requireLogin, async (req, res) => {
  const db = await abrirBanco();
  const empresaId = req.session.usuarioLogado.empresa_id;

  const procedimentos = await db.all(
    'SELECT * FROM procedimentos WHERE empresa_id = ?',
    [empresaId]
  );

  const msg = req.session.msg || null;
  delete req.session.msg;

  await db.close();
  res.render('editarProcedimento', {
    procedimentos,
    msg
  });
});



// Salvar alterações de procedimentos
app.post('/procedimentos', requireLogin, async (req, res) => {
  const db = await abrirBanco();
  const empresaId = req.session.usuarioLogado.empresa_id;

  try {
    const procedimentos = await db.all(
      'SELECT * FROM procedimentos WHERE empresa_id = ?',
      [empresaId]
    );

    for (const p of procedimentos) {
      const novaDuracao = req.body[`duracao_${p.id}`];
      const novoValor = req.body[`valor_${p.id}`];

      if (novaDuracao !== undefined && novoValor !== undefined) {
        await db.run(
          'UPDATE procedimentos SET duracao = ?, valor = ? WHERE id = ? AND empresa_id = ?',
          [novaDuracao, novoValor, p.id, empresaId]
        );
      }
    }

    req.session.msg = 'Procedimentos atualizados com sucesso!';
    res.redirect('/editar-procedimento');

  } catch (error) {
    console.error('Erro ao atualizar procedimentos:', error.message);
    req.session.msg = 'Erro ao atualizar procedimentos: ' + error.message;
    res.redirect('/editar-procedimento');

  } finally {
    await db.close();
  }
});
app.get('/excluir-procedimento/:id', requireLogin, async (req, res) => {
  const { id } = req.params;
  const empresaId = req.session.usuarioLogado.empresa_id;
  const db = await abrirBanco();

  try {
    const result = await db.run(
      'DELETE FROM procedimentos WHERE id = ? AND empresa_id = ?',
      [id, empresaId]
    );

    req.session.msg = result.changes === 0
      ? { tipo: 'erro', texto: 'Procedimento não encontrado ou não pertence à sua empresa.' }
      : { tipo: 'sucesso', texto: 'Procedimento excluído com sucesso!' };

    res.redirect('/procedimentos');
  } catch (error) {
    console.error('Erro ao excluir procedimento:', error.message);
    res.status(500).send('Erro ao excluir procedimento: ' + error.message);
  } finally {
    await db.close();
  }
});

app.get('/redefinir-senha/:token', async (req, res) => {
  const { token } = req.params;

  if (!token || token.length < 10) {
    return res.send('Token inválido.');
  }

  const db = await abrirBanco();
  const usuario = await db.get(`
    SELECT * FROM usuarios
    WHERE token_redefinicao = ? AND expira_token > datetime('now') AND token_redefinicao IS NOT NULL
  `, [token]);

  await db.close();

  if (!usuario) {
    return res.send('Link inválido ou expirado.');
  }

  res.render('redefinirSenha', { token });
});
app.post('/redefinir-senha/:token', async (req, res) => {
  const { token } = req.params;
  const { senha, confirmarSenha } = req.body;

  if (!token || token.length < 10) {
    return res.send('Token inválido.');
  }

  if (!senha || senha.length < 5 || senha !== confirmarSenha) {
    return res.send('As senhas devem ter no mínimo 5 caracteres e coincidir.');
  }

  const db = await abrirBanco();

  const usuario = await db.get(`
    SELECT * FROM usuarios
    WHERE token_redefinicao = ? AND expira_token > datetime('now') AND token_redefinicao IS NOT NULL
  `, [token]);

  if (!usuario) {
    await db.close();
    return res.send('Link inválido ou expirado.');
  }

  const senhaHash = await bcrypt.hash(senha, 10);

  await db.run(`
    UPDATE usuarios
    SET senha = ?, token_redefinicao = NULL, expira_token = NULL
    WHERE id = ? AND empresa_id = ? AND token_redefinicao IS NOT NULL AND expira_token > datetime('now')
  `, [senhaHash, usuario.id, usuario.empresa_id]);

  await db.close();

  res.send(`
    <html>
      <head><script src="https://cdn.jsdelivr.net/npm/sweetalert2@11"></script></head>
      <body>
        <script>
          Swal.fire({
            icon: 'success',
            title: 'Senha redefinida com sucesso!',
            text: 'Agora você pode fazer login.',
            confirmButtonText: 'Ir para o Login'
          }).then(() => {
            window.location.href = '/login';
          });
        </script>
      </body>
    </html>
  `);
});

app.post('/login', async (req, res) => {
  const { email, senha, tipo } = req.body;

  const db = await abrirBanco();

  try {
    const usuario = await db.get('SELECT * FROM usuarios WHERE email = ?', [email.trim().toLowerCase()]);

    if (!usuario) {
      await db.close();
      return res.render('login', { erro: 'Usuário não encontrado.' });
    }

    const senhaCorreta = await bcrypt.compare(senha, usuario.senha);

    if (!senhaCorreta) {
      await db.close();
      return res.render('login', { erro: 'Senha incorreta.' });
    }

    // Salva dados completos na sessão
    req.session.usuarioLogado = {
      id: usuario.id,
      nome: usuario.nome,
      email: usuario.email,
      tipo: usuario.tipo,
      empresa_id: usuario.empresa_id
    };

    req.session.tipo = usuario.tipo;
    req.session.nome_usuario = usuario.nome;
    req.session.empresa_id = usuario.empresa_id;

    await db.close();

    res.redirect('/agendamentos'); // ajuste conforme seu fluxo

  } catch (error) {
    console.error('Erro no login:', error.message);
    await db.close();
    res.render('login', { erro: 'Erro interno ao tentar fazer login.' });
  }
});


app.post('/cadastro-empresa', async (req, res) => {
  const { nome_empresa, email_admin, senha_admin, confirmar_senha } = req.body;

  if (senha_admin !== confirmar_senha) {
    return res.render('erroCadastroEmpresa', { erro: 'As senhas não coincidem.' });
  }

  const db = await abrirBanco();
  try {
    // Verifica se e-mail já está em uso
    const existe = await db.get('SELECT * FROM empresas WHERE email_admin = ?', [email_admin]);
    if (existe) {
      await db.close();
      return res.render('erroCadastroEmpresa', { erro: 'E-mail já cadastrado.' });
    }

    const senhaHash = await bcrypt.hash(senha_admin, 10);

    // Cria empresa
    await db.run(`
      INSERT INTO empresas (nome_empresa, email_admin, senha_admin)
      VALUES (?, ?, ?)
    `, [nome_empresa, email_admin, senhaHash]);

    const empresaCriada = await db.get('SELECT id FROM empresas WHERE email_admin = ?', [email_admin]);

    // Cria usuário administrador
    await db.run(`
      INSERT INTO usuarios (empresa_id, nome, email, senha, tipo)
      VALUES (?, ?, ?, ?, ?)
    `, [empresaCriada.id, 'Administrador', email_admin, senhaHash, 'admin']);

    await db.close();

    // ✅ Insere procedimentos padrão para esta empresa
    await inserirProcedimentosIniciais(empresaCriada.id);

    res.render('sucessoCadastroEmpresa');

  } catch (error) {
    await db.close();
    console.error('Erro ao cadastrar empresa:', error);
    res.render('erroCadastroEmpresa', {
      erro: 'Erro ao cadastrar empresa: ' + error.message
    });
  }
});

app.get('/cadastro', (req, res) => {
  res.render('cadastro_empresa_admin', { msg: null });
});


app.get('/painel-admin', requireLogin, (req, res) => {
  if (req.session.usuarioLogado?.tipo !== 'admin') {
    return res.status(403).send('Acesso restrito ao administrador.');
  }

  res.render('painelAdmin', {
    nome_usuario: req.session.usuarioLogado.nome
  });
});


app.get('/listar-usuarios', requireLogin, async (req, res) => {
  const empresaId = req.session.usuarioLogado.empresa_id;

  const db = await abrirBanco();
  const usuarios = await db.all(
    'SELECT id, nome, email, tipo FROM usuarios WHERE empresa_id = ?',
    [empresaId]
  );
  await db.close();

  res.json(usuarios);
});

app.post('/esqueci-senha', async (req, res) => {
  const { email } = req.body;
  const emailLimpo = email.trim().toLowerCase();
  const db = await abrirBanco();

  try {
    const usuario = await db.get('SELECT * FROM usuarios WHERE email = ?', [emailLimpo]);

    if (usuario) {
      const token = crypto.randomBytes(32).toString('hex');
      const expira = new Date(Date.now() + 1000 * 60 * 15).toISOString(); // 15 minutos

      await db.run(
        'UPDATE usuarios SET token_redefinicao = ?, expira_token = ? WHERE id = ? AND empresa_id = ?',
        [token, expira, usuario.id, usuario.empresa_id]
      );

      await enviarEmailRedefinicao(emailLimpo, token);
    }
  } catch (error) {
    console.error('Erro ao solicitar redefinição de senha:', error);
    // Não interrompe o fluxo: o usuário verá sempre a mesma mensagem
  } finally {
    await db.close();
  }

  // Mensagem neutra que não revela se o e-mail existe
  res.render('esqueciSenha', {
    msg: 'Se o e-mail estiver registrado, você receberá um link de redefinição.'
  });
});


app.get('/criar-senha', async (req, res) => {
  const { token } = req.query;

  if (!token) {
    return res.status(400).send('Token não fornecido.');
  }

  const db = await abrirBanco();

  try {
    const usuario = await db.get(`
      SELECT * FROM usuarios
      WHERE token_redefinicao = ? 
        AND token_redefinicao IS NOT NULL 
        AND expira_token > datetime('now')
    `, [token]);

    if (!usuario) {
      return res.status(400).send('Token expirado ou inválido.');
    }

    res.render('criarSenha', { token, msg: null });
  } catch (error) {
    console.error('Erro ao validar token de redefinição:', error);
    res.status(500).send('Erro ao processar o link de redefinição.');
  } finally {
    await db.close();
  }
});
app.post('/criar-senha', async (req, res) => {
  const { token, novaSenha, confirmarSenha } = req.body;

  if (!token || !novaSenha || !confirmarSenha) {
    return res.status(400).send('Dados incompletos.');
  }

  if (novaSenha !== confirmarSenha) {
    return res.render('criarSenha', { token, msg: 'As senhas não coincidem.' });
  }

  const db = await abrirBanco();

  try {
    const usuario = await db.get(`
      SELECT * FROM usuarios
      WHERE token_redefinicao = ? 
        AND token_redefinicao IS NOT NULL 
        AND expira_token > datetime('now')
    `, [token]);

    if (!usuario) {
      return res.status(400).send('Token expirado ou inválido.');
    }

    const novaHash = await bcrypt.hash(novaSenha, 10);

    await db.run(`
      UPDATE usuarios 
      SET senha = ?, token_redefinicao = NULL, expira_token = NULL 
      WHERE id = ? AND empresa_id = ? 
        AND token_redefinicao IS NOT NULL 
        AND expira_token > datetime('now')
    `, [novaHash, usuario.id, usuario.empresa_id]);

    res.send(`
      <html>
        <head>
          <script src="https://cdn.jsdelivr.net/npm/sweetalert2@11"></script>
        </head>
        <body>
          <script>
            Swal.fire({
              icon: 'success',
              title: 'Senha redefinida com sucesso!',
              text: 'Agora você pode fazer login normalmente.',
              confirmButtonText: 'Ir para o Login'
            }).then(() => {
              window.location.href = '/login';
            });
          </script>
        </body>
      </html>
    `);
  } catch (error) {
    console.error('Erro ao redefinir senha:', error);
    res.status(500).send('Erro ao redefinir senha.');
  } finally {
    await db.close();
  }
});
app.get('/verificar-email', async (req, res) => {
  const emailLimpo = req.query.email?.trim().toLowerCase();

  if (!emailLimpo) {
    return res.status(400).json({ erro: 'E-mail não fornecido.' });
  }

  const db = await abrirBanco();
  const empresa = await db.get('SELECT id FROM empresas WHERE email_admin = ?', [emailLimpo]);
  await db.close();

  res.json({ existe: !!empresa });
});

app.get('/especialidades', requireLogin, async (req, res) => {
  const db = await abrirBanco();
  const empresaId = req.session.usuarioLogado.empresa_id;

  try {
    const especialidades = await db.all(
      'SELECT * FROM especialidades WHERE empresa_id = ?',
      [empresaId]
    );

    res.render('especialidades', { especialidades });
  } catch (error) {
    console.error('Erro ao carregar especialidades:', error);
    res.status(500).send('Erro ao carregar especialidades');
  } finally {
    await db.close();
  }
});

app.get('/nova-especialidade', requireLogin, async (req, res) => {
  res.render('novaEspecialidade', { msg: null });
});

app.post('/editar-especialidade/:id', requireLogin, async (req, res) => {
  const db = await abrirBanco();
  const { id } = req.params;
  const { nome } = req.body;

  try {
    await db.run('UPDATE especialidades SET nome = ? WHERE id = ?', [nome, id]);
    req.session.msg = { tipo: 'sucesso', texto: 'Especialidade atualizada com sucesso!' };
    res.redirect('/especialidades');
  } catch (err) {
    res.render('editarEspecialidade', {
      especialidade: { id, nome },
      msg: { tipo: 'erro', texto: 'Erro ao atualizar especialidade: ' + err.message }
    });
  } finally {
    await db.close();
  }
});

app.post('/editar-especialidade/:id', requireLogin, async (req, res) => {
  const db = await abrirBanco();
  const { id } = req.params;
  const { nome } = req.body;

  try {
    await db.run('UPDATE especialidades SET nome = ? WHERE id = ?', [nome, id]);

    req.session.msg = { tipo: 'sucesso', texto: 'Especialidade atualizada com sucesso!' };
    res.redirect('/especialidades');
  } catch (err) {
    res.render('editarEspecialidade', {
      especialidade: { id, nome },
      msg: { tipo: 'erro', texto: 'Erro ao atualizar especialidade: ' + err.message }
    });
  } finally {
    await db.close();
  }
});

const ExcelJS = require('exceljs');

app.get('/relatorios/excel', requireLogin, async (req, res) => {
  const db = await abrirBanco();
  const empresaId = req.session.usuarioLogado.empresa_id;

  // Buscar agendamentos básicos
  const agendamentos = await db.all(`
    SELECT a.id, c.nome AS cliente, f.nome AS funcionario, a.dia, a.horario
    FROM agendamentos a
    JOIN clientes c ON c.id = a.cliente_id
    JOIN funcionarios f ON f.id = a.funcionario_id
    WHERE a.empresa_id = ?
  `, [empresaId]);

  // Buscar procedimentos por agendamento
  for (const agendamento of agendamentos) {
    const procedimentos = await db.all(`
      SELECT p.nome, p.valor
      FROM agendamento_procedimentos ap
      JOIN procedimentos p ON p.id = ap.procedimento_id
      WHERE ap.agendamento_id = ?
    `, [agendamento.id]);

    agendamento.procedimentos = procedimentos.map(p => p.nome).join(', ');
    agendamento.valor_total = procedimentos.reduce((total, p) => total + p.valor, 0);
  }

  const workbook = new ExcelJS.Workbook();
  const worksheet = workbook.addWorksheet('Agendamentos');

  worksheet.columns = [
    { header: 'ID', key: 'id', width: 10 },
    { header: 'Cliente', key: 'cliente', width: 30 },
    { header: 'Funcionário', key: 'funcionario', width: 30 },
    { header: 'Data', key: 'dia', width: 15 },
    { header: 'Horário', key: 'horario', width: 10 },
    { header: 'Procedimentos', key: 'procedimentos', width: 40 },
    { header: 'Valor Total (R$)', key: 'valor_total', width: 20 }
  ];

  agendamentos.forEach(ag => worksheet.addRow(ag));

  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', 'attachment; filename=agendamentos.xlsx');

  await workbook.xlsx.write(res);
  res.end();
});


app.get('/', (req, res) => res.redirect('/agendamentos'));

app.listen(PORT, () => {
    console.log(`Acesse http://localhost:${PORT}`);
  });
