const express = require('express');
const session = require('express-session');
const bcrypt = require('bcrypt');
const sqlite3 = require('sqlite3');
const { open } = require('sqlite');
const path = require('path');
const dayjs = require('dayjs'); // use `npm install dayjs` se ainda não tiver
const duration = require('dayjs/plugin/duration');
const isSameOrBefore = require('dayjs/plugin/isSameOrBefore');
const fs = require('fs');
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
  
    await db.run(`
      CREATE TABLE IF NOT EXISTS empresas (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        nome_empresa TEXT NOT NULL,
        email_admin TEXT NOT NULL UNIQUE,
        senha_admin TEXT NOT NULL
      );
    `);

    
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
        valor REAL,
        duracao INTEGER
      );
    `);
    
    const cols = await db.all(`PRAGMA table_info(procedimentos)`);
    const temDuracao = cols.some(c => c.name === 'duracao');
    if (!temDuracao) {
      await db.run(`ALTER TABLE procedimentos ADD COLUMN duracao INTEGER`);
}
    await db.run(`
      CREATE TABLE IF NOT EXISTS agendamentos (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        cliente_id INTEGER,
        dia TEXT,
        horario TEXT,
        funcionario_id INTEGER,
        finalizado INTEGER DEFAULT 0,
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
    await db.run(`
        CREATE TABLE IF NOT EXISTS horarios_funcionarios (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          funcionario_id INTEGER,
          dia_semana TEXT,
          horario TEXT,
          FOREIGN KEY (funcionario_id) REFERENCES funcionarios(id)
        );
      `);

      
    await db.run(`
      CREATE TABLE IF NOT EXISTS horarios_expeds (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          funcionario_id INTEGER,
          dia_semana TEXT,
          inicio TEXT,  -- exemplo: '09:00'
          fim TEXT,     -- exemplo: '18:00'
          FOREIGN KEY (funcionario_id) REFERENCES funcionarios(id)
          );
        `);
        
        await db.run(`
          CREATE TABLE IF NOT EXISTS procedimento_especialidade (
            procedimento_id INTEGER,
            especialidade_id INTEGER,
            PRIMARY KEY (procedimento_id, especialidade_id),
            FOREIGN KEY (procedimento_id) REFERENCES procedimentos(id),
            FOREIGN KEY (especialidade_id) REFERENCES especialidades(id)
          );
        `);
        

        await db.run(`
          CREATE TABLE IF NOT EXISTS empresas (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            nome_empresa TEXT NOT NULL,
            email_admin TEXT NOT NULL UNIQUE,
            senha_admin TEXT NOT NULL
          );
        `);
        
  }


  async function criarEmpresaEAdminPadrao() {
      const db = await abrirBanco();
  
      // Verifica se já existe uma empresa cadastrada
      const empresaExistente = await db.get('SELECT * FROM empresas LIMIT 1');
  
      if (!empresaExistente) {
          console.log('Nenhuma empresa encontrada. Criando empresa e admin padrão...');
  
          // Cria empresa padrão
          await db.run(`
              INSERT INTO empresas (nome_empresa, email_admin, senha_admin)
              VALUES (?, ?, ?)
          `, ['Minha Empresa Exemplo', 'admin@example.com', await bcrypt.hash('admin123', 10)]);
  
          const empresaCriada = await db.get('SELECT id FROM empresas WHERE email_admin = ?', ['admin@example.com']);
  
          // Cria usuário admin padrão com senha criptografada
          const senhaCriptografada = await bcrypt.hash('admin123', 10);
  
          await db.run(`
              INSERT INTO usuarios (empresa_id, nome, email, senha, tipo)
              VALUES (?, ?, ?, ?, ?)
          `, [
              empresaCriada.id,
              'Administrador',
              'admin@example.com',
              senhaCriptografada,
              'admin'
          ]);
  
          console.log('Empresa e administrador padrão criados com sucesso (senha segura)!');
      }
  
      await db.close();
  }
  


async function inserirProcedimentosIniciais() {
    const db = await abrirBanco();
    const procedimentos = [
      { nome: "Corte Feminino", valor: 60, duracao: 40 },
      { nome: "Corte Masculino", valor: 40, duracao: 30 },
      { nome: "Escova", valor: 50, duracao: 45 },
      { nome: "Manicure", valor: 30, duracao: 30 },
      { nome: "Pedicure", valor: 35, duracao: 30 }
    ];    

    const row = await db.get('SELECT COUNT(*) as total FROM procedimentos');
    if (row.total === 0) {
        for (const p of procedimentos) {
          await db.run('INSERT INTO procedimentos (nome, valor, duracao) VALUES (?, ?, ?)', [p.nome, p.valor, p.duracao]);
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

  async function atualizarColunaFinalizado() {
    const db = await abrirBanco();
    try {
      await db.run('ALTER TABLE agendamentos ADD COLUMN finalizado INTEGER DEFAULT 0;');
      console.log('Coluna finalizado adicionada.');
    } catch (error) {
      if (error.message.includes('duplicate column name')) {
      } else {
        console.error('Erro ao adicionar coluna finalizado:', error.message);
      }
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
    await atualizarColunaFinalizado();
    await atualizarEstruturaBanco(); 
    await inserirProcedimentosIniciais();
    await inserirEspecialidadesPadrao();
    await criarEmpresaEAdminPadrao(); // <==== adicione essa linha aqui!
  })();
  
  
  
function formatarCPF(cpf) {
    return cpf.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, "$1.$2.$3-$4");
}

function requireLogin(req, res, next) {
  if (req.session && req.session.usuarioLogado) {
    return next();
  }
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
          whereClauses.push(`a.id IN (
              SELECT agendamento_id
              FROM agendamento_procedimentos
              WHERE procedimento_id = ?
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

  let where = 'WHERE ' + whereClauses.join(' AND ');
  
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
JOIN clientes c ON a.cliente_id = c.id
LEFT JOIN funcionarios f ON a.funcionario_id = f.id
LEFT JOIN agendamento_procedimentos ap ON ap.agendamento_id = a.id
LEFT JOIN procedimentos p ON p.id = ap.procedimento_id
${where}
GROUP BY a.id
ORDER BY a.dia, a.horario
  `;

  const db = await abrirBanco();
  const ags = await db.all(sql, params);
  const listaProcedimentos = await db.all('SELECT * FROM procedimentos');
  const funcionarios = await db.all('SELECT * FROM funcionarios');
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
      msg: msg,
      valor: filtro === 'nome' || filtro === 'cpf' ? valorTexto
           : filtro === 'procedimento' ? valorProcedimento
           : filtro === 'dia' ? valorData
           : filtro === 'funcionario' ? valorFuncionario
           : '',
      tipo: req.session.tipo,
      nome_usuario: req.session.nome_usuario
  });
});


app.get('/novo-agendamento', requireLogin, async (req, res) => {
  const db = await abrirBanco();
  const clientes = await db.all('SELECT * FROM clientes');
  const funcionarios = await db.all('SELECT * FROM funcionarios');
  const procedimentos = await db.all('SELECT * FROM procedimentos');
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
      funcionarios: funcionarios || [],
      especialidades: especialidades || [],
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
      const result = await db.run('INSERT INTO funcionarios (nome) VALUES (?)', [nome]);

      const funcionarioId = result.lastID;

      for (const espId of especialidade_ids) {
          await db.run('INSERT INTO funcionario_especialidades (funcionario_id, especialidade_id) VALUES (?, ?)', [funcionarioId, espId]);
      }

      req.session.msg = 'Funcionário cadastrado com sucesso!';
      res.redirect('/funcionarios');
  } catch (err) {
      const funcionarios = await db.all(`
        SELECT f.id, f.nome,
               GROUP_CONCAT(e.nome, ', ') AS especialidades
        FROM funcionarios f
        LEFT JOIN funcionario_especialidades fe ON f.id = fe.funcionario_id
        LEFT JOIN especialidades e ON fe.especialidade_id = e.id
        GROUP BY f.id
      `);
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

app.get('/horarios-disponiveis', requireLogin, async (req, res) => {
  const { funcionario_id, dia, procedimentos } = req.query;

  if (!funcionario_id || !dia || !procedimentos) {
    return res.status(400).json({ erro: 'Dados incompletos.' });
  }

  const procedimentosIds = Array.isArray(procedimentos) ? procedimentos : [procedimentos];

  const db = await abrirBanco();

  try {
    const diasSemana = ['domingo', 'segunda', 'terca', 'quarta', 'quinta', 'sexta', 'sabado'];
    const nomeDiaSemana = diasSemana[new Date(dia).getDay()];

    console.log('Dia da semana:', nomeDiaSemana);

    // Buscar expediente
    const expediente = await db.get(`
      SELECT inicio, fim FROM horarios_expeds
      WHERE funcionario_id = ? AND dia_semana = ?
    `, [funcionario_id, nomeDiaSemana]);

    if (!expediente || !expediente.inicio || !expediente.fim) {
      await db.close();
      return res.json({ horarios: [], ocupados: [] });
    }

    // Buscar agendamentos ocupados + durações
    const agendamentos = await db.all(`
      SELECT a.horario, IFNULL(SUM(p.duracao), 0) as duracaoTotal
      FROM agendamentos a
      LEFT JOIN agendamento_procedimentos ap ON ap.agendamento_id = a.id
      LEFT JOIN procedimentos p ON p.id = ap.procedimento_id
      WHERE a.funcionario_id = ? AND a.dia = ?
      GROUP BY a.id
    `, [funcionario_id, dia]);

    // Gerar lista de horários ocupados considerando duração + intervalo
    const horariosOcupados = [];

    agendamentos.forEach(ag => {
      let inicio = dayjs(`${dia}T${ag.horario}`);
      const duracaoComIntervalo = ag.duracaoTotal + 10; // incluir intervalo de descanso
      const fim = inicio.add(duracaoComIntervalo, 'minute');

      while (inicio.isBefore(fim)) {
        horariosOcupados.push(inicio.format('HH:mm'));
        inicio = inicio.add(10, 'minute'); // marca de 10 em 10 minutos como ocupado
      }
    });

    // Buscar duração dos novos procedimentos a serem agendados
    const placeholders = procedimentosIds.map(() => '?').join(',');
    const total = await db.get(`
      SELECT SUM(duracao) as duracaoTotal
      FROM procedimentos
      WHERE id IN (${placeholders})
    `, procedimentosIds);

    const duracaoProcedimentos = total?.duracaoTotal || 0;
    const duracaoTotalComIntervalo = duracaoProcedimentos + 10; // +10min de intervalo

    console.log('Duração total incluindo intervalo:', duracaoTotalComIntervalo, 'minutos');

    // Agora gerar todos os horários
    const horarios = [];
    let horaAtual = dayjs(`${dia}T${expediente.inicio}`);
    const horaFim = dayjs(`${dia}T${expediente.fim}`);

    while (horaAtual.add(duracaoTotalComIntervalo, 'minute').isSameOrBefore(horaFim)) {
      const horarioTexto = horaAtual.format('HH:mm');

      // Verificar se algum pedaço da faixa está ocupado
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

    // Manda agora { horarios: [{horario: "05:00", ocupado: false}, ...] }
    res.json(horarios);

  } catch (error) {
    console.error('Erro ao carregar horários:', error);
    await db.close();
    res.status(500).json({ erro: 'Erro interno ao buscar horários' });
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
      
      app.get('/horarios-funcionario/:id', requireLogin, async (req, res) => {
        const db = await abrirBanco();
        const funcionario = await db.get('SELECT * FROM funcionarios WHERE id = ?', [req.params.id]);
      
        if (!funcionario) {
          await db.close();
          return res.status(404).send('Funcionário não encontrado.');
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
      
        const db = await abrirBanco();
        await db.run(
          'INSERT INTO horarios_funcionarios (funcionario_id, dia_semana, horario) VALUES (?, ?, ?)',
          [funcionario_id, dia_semana, horario]
        );
        await db.close();
        res.redirect(`/horarios-funcionario/${funcionario_id}`);
      });

      app.post('/horarios-funcionario/:id/remover/:horarioId', requireLogin, async (req, res) => {
        const db = await abrirBanco();
        await db.run('DELETE FROM horarios_funcionarios WHERE id = ?', [req.params.horarioId]);
        await db.close();
        res.redirect(`/horarios-funcionario/${req.params.id}`);
      });
      // Exibe a página com o dropdown para escolher funcionário
        app.get('/escolher-funcionario-horario', requireLogin, async (req, res) => {
            const db = await abrirBanco();
            const funcionarios = await db.all('SELECT * FROM funcionarios');
            await db.close();
        
            res.render('escolherHorarioFuncionario', { funcionarios });
        });
        
        // Redireciona para a página de horários do funcionário selecionado
        app.post('/escolher-funcionario-horario', requireLogin, (req, res) => {
            const id = req.body.funcionario_id;
            if (!id) return res.redirect('/funcionarios');
            res.redirect(`/horarios-funcionario/${id}`);
        });

        app.get('/expediente-funcionario/:id', requireLogin, async (req, res) => {
          const db = await abrirBanco();
          const funcionario = await db.get('SELECT * FROM funcionarios WHERE id = ?', [req.params.id]);
          
          if (!funcionario) {
            await db.close();
            return res.status(404).send('Funcionário não encontrado.');
          }
        
          const registros = await db.all(`
            SELECT dia_semana, inicio, fim
            FROM horarios_expeds
            WHERE funcionario_id = ?
          `, [req.params.id]);
        
          // Mapeia os horários por dia da semana
          const expediente = {};
          registros.forEach(r => {
            expediente[r.dia_semana] = { inicio: r.inicio, fim: r.fim };
          });
        
          await db.close();
        
          // Pega se veio parâmetro sucesso=1
          const sucesso = req.query.sucesso === '1';
        
          res.render('expedienteFuncionario', {
            funcionario,
            expediente,
            sucesso
          });
        });
        
          
        app.post('/expediente-funcionario/:id', requireLogin, async (req, res) => {
          const funcionarioId = req.params.id;
          const db = await abrirBanco();
        
          const diasSemana = ['domingo', 'segunda', 'terca', 'quarta', 'quinta', 'sexta', 'sabado'];
        
          try {
            await db.run('DELETE FROM horarios_expeds WHERE funcionario_id = ?', [funcionarioId]);
        
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
        
        

          app.get('/corrigir-expediente', async (req, res) => {
            console.log("⚙️ Rota /corrigir-expediente foi chamada!");
          
            const db = await abrirBanco();
          
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
                await db.run(`UPDATE horarios_expeds SET dia_semana = ? WHERE LOWER(dia_semana) = ?`, [corrigido, original.toLowerCase()]);
              }
            
              await db.close();
              res.send('Expediente corrigido com sucesso!');
            });
            
            app.get('/corrigir-duracoes', async (req, res) => {
              const db = await abrirBanco();
              const duracoes = {
                'Corte Feminino': 60,
                'Corte Masculino': 45,
                'Escova': 40,
                'Manicure': 30,
                'Pedicure': 30
              };
              for (const nome in duracoes) {
                const duracao = duracoes[nome];
                await db.run(`UPDATE procedimentos SET duracao = ? WHERE nome = ?`, [duracao, nome]);
              }
              await db.close();
              res.send('Durações corrigidas com sucesso!');
            });


            app.get('/procedimentos', requireLogin, async (req, res) => {
              const db = await abrirBanco();
              const procedimentos = await db.all('SELECT * FROM procedimentos');
              await db.close();
            
              const msg = req.session.msg || null;
              delete req.session.msg;
            
              res.render('procedimentos', {
                procedimentos: procedimentos || [],
                msg: msg || null
            });
          });
            
            

          app.post('/procedimentos', requireLogin, async (req, res) => {
            const db = await abrirBanco();
          
            try {
              for (const key in req.body) {
                const [tipo, id] = key.split('_');
                const valorCampo = req.body[key];
          
                if (tipo === 'duracao' || tipo === 'valor') {
                  const duracao = req.body[`duracao_${id}`];
                  const valor = req.body[`valor_${id}`];
          
                  // Verifica se os valores são válidos
                  if (duracao && valor && duracao > 0 && valor >= 0) {
                    await db.run('UPDATE procedimentos SET duracao = ?, valor = ? WHERE id = ?', [duracao, valor, id]);
                  }
                }
              }
          
              await db.close();
              res.redirect('/procedimentos?sucesso=editado'); // <<< Alterado aqui para mostrar SweetAlert
          
            } catch (error) {
              await db.close();
              res.send('Erro ao atualizar procedimentos: ' + error.message);
            }
          });
          
            
      app.get('/novo-funcionario', requireLogin, async (req, res) => {
        const db = await abrirBanco();
        const especialidades = await db.all('SELECT * FROM especialidades');
        await db.close();
        res.render('novoFuncionario', { especialidades, msg: null });  // <<< AQUI
      });
      

      app.post('/novo-funcionario', requireLogin, async (req, res) => {
        const { nome } = req.body;
        // As especialidades podem vir como string ou array; forçamos array
        let especialidade_ids = req.body.especialidade_ids;
        if (!Array.isArray(especialidade_ids)) {
          especialidade_ids = especialidade_ids ? [especialidade_ids] : [];
        }
      
        const db = await abrirBanco();
        try {
          // Insere o novo funcionário
          const result = await db.run(
            'INSERT INTO funcionarios (nome) VALUES (?)',
            [nome]
          );
          const funcionarioId = result.lastID;
      
          // Insere os vínculos em funcionario_especialidades
          for (const espId of especialidade_ids) {
            await db.run(
              'INSERT INTO funcionario_especialidades (funcionario_id, especialidade_id) VALUES (?, ?)',
              [funcionarioId, espId]
            );
          }
      
          await db.close();
          req.session.msg = 'Funcionário cadastrado com sucesso!';
          res.redirect('/funcionarios');
        } catch (err) {
          // Em caso de erro, renderiza o formulário novamente com mensagem
          const especialidades = await db.all('SELECT * FROM especialidades');
          await db.close();
          res.render('novoFuncionario', {
            especialidades,
            msg: 'Erro ao cadastrar funcionário: ' + err.message
          });
        }
      });
      
      app.get('/especialidades', requireLogin, async (req, res) => {
        const db = await abrirBanco();
        const especialidades = await db.all('SELECT * FROM especialidades');
        await db.close();
      
        res.render('especialidades', { especialidades });
      });
      
            
      app.get('/nova-especialidade', requireLogin, (req, res) => {
        res.render('novaEspecialidade');
      });
      
      app.post('/nova-especialidade', requireLogin, async (req, res) => {
        const { nome } = req.body;
        const db = await abrirBanco();
        try {
          await db.run('INSERT INTO especialidades (nome) VALUES (?)', [nome]);
          req.session.msg = 'Especialidade cadastrada com sucesso!';
        } catch (error) {
          req.session.msg = 'Erro ao cadastrar especialidade: ' + error.message;
        }
        await db.close();
        res.redirect('/especialidades');
      });
      

      app.get('/editar-especialidade/:id', requireLogin, async (req, res) => {
        const db = await abrirBanco();
        const especialidade = await db.get('SELECT * FROM especialidades WHERE id = ?', [req.params.id]);
        await db.close();
        
        res.render('editarEspecialidade', { especialidade });
      });

      app.get('/relatorios', requireLogin, async (req, res) => {
        const db = await abrirBanco();
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
          pagina = 1 // Página atual, padrão 1
        } = req.query;
      
        const itensPorPagina = 10; // 🔥 Número de registros por página
        const offset = (pagina - 1) * itensPorPagina;
      
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
      
        whereClauses.push('a.finalizado = 1');
      
        const where = whereClauses.length ? 'WHERE ' + whereClauses.join(' AND ') : '';
      
        // 1º - Buscar total de registros
        const totalAgendamentosRow = await db.get(`
          SELECT COUNT(DISTINCT a.id) AS total
          FROM agendamentos a
          JOIN clientes c ON a.cliente_id = c.id
          LEFT JOIN funcionarios f ON a.funcionario_id = f.id
          LEFT JOIN agendamento_procedimentos ap ON ap.agendamento_id = a.id
          LEFT JOIN procedimentos p ON p.id = ap.procedimento_id
          ${where}
        `, params);
      
        const totalAgendamentos = totalAgendamentosRow.total || 0;
        const temProximaPagina = (pagina * itensPorPagina) < totalAgendamentos;
      
        // 2º - Buscar agendamentos da página atual
        const agendamentos = await db.all(`
          SELECT 
            a.id,
            c.nome AS cliente_nome,
            f.nome AS funcionario_nome,
            a.dia,
            a.horario,
            SUM(p.valor) as valor_total
          FROM agendamentos a
          JOIN clientes c ON a.cliente_id = c.id
          LEFT JOIN funcionarios f ON a.funcionario_id = f.id
          LEFT JOIN agendamento_procedimentos ap ON ap.agendamento_id = a.id
          LEFT JOIN procedimentos p ON p.id = ap.procedimento_id
          ${where}
          GROUP BY a.id
          ORDER BY a.dia ASC, a.horario ASC
          LIMIT ${itensPorPagina} OFFSET ${offset}
        `, params);
      
        const procedimentos = await db.all('SELECT id, nome FROM procedimentos');
        const funcionarios = await db.all('SELECT id, nome FROM funcionarios');
      
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
    
    
    const PDFDocument = require('pdfkit'); // não esqueça de garantir esse import lá em cima!

    app.get('/relatorios/pdf', requireLogin, async (req, res) => {
        const db = await abrirBanco();
    
        const { dataInicio, dataFim, funcionario_id, procedimento_id } = req.query;
    
        let whereClauses = [];
        let params = [];
    
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
    
        const where = whereClauses.length ? 'WHERE ' + whereClauses.join(' AND ') : '';
    
        const sql = `
            SELECT 
                a.id,
                a.dia,
                a.horario,
                c.nome AS cliente_nome,
                f.nome AS funcionario_nome,
                IFNULL(SUM(p.valor), 0) AS valor_total
            FROM agendamentos a
            JOIN clientes c ON c.id = a.cliente_id
            JOIN funcionarios f ON f.id = a.funcionario_id
            LEFT JOIN agendamento_procedimentos ap ON ap.agendamento_id = a.id
            LEFT JOIN procedimentos p ON p.id = ap.procedimento_id
            ${where}
            GROUP BY a.id
            ORDER BY a.dia, a.horario
        `;
    
        const agendamentos = await db.all(sql, params);
        await db.close();
    
        // Criar o documento PDF
        const doc = new PDFDocument();
        res.setHeader('Content-disposition', 'attachment; filename="relatorio-agendamentos.pdf"');
        res.setHeader('Content-type', 'application/pdf');
        doc.pipe(res);
    
        // Cabeçalho
        doc.fontSize(20).text('Relatório de Agendamentos', { align: 'center' });
        doc.moveDown();
    
        // Listar agendamentos
        agendamentos.forEach((a, idx) => {
            doc.fontSize(12).text(`Cliente: ${a.cliente_nome}`);
            doc.text(`Funcionário: ${a.funcionario_nome}`);
            doc.text(`Data: ${a.dia}`);
            doc.text(`Horário: ${a.horario}`);
            doc.text(`Valor Total: R$ ${parseFloat(a.valor_total || 0).toFixed(2)}`);
            doc.moveDown();
            if (idx !== agendamentos.length - 1) doc.moveDown(); // espaço entre registros
        });
    
        // Resumo Financeiro
        const valorTotalGeral = agendamentos.reduce((acc, a) => acc + (a.valor_total || 0), 0);
    
        doc.moveDown(2);
        doc.fontSize(14).text('Resumo Financeiro', { underline: true });
        doc.moveDown();
    
        doc.fontSize(12).text(`Total de agendamentos: ${agendamentos.length}`);
        doc.text(`Valor total: R$ ${valorTotalGeral.toFixed(2)}`);
    
        doc.end();
    });
    
    const ExcelJS = require('exceljs'); // não esqueça de garantir esse import lá em cima!

app.get('/relatorios/excel', requireLogin, async (req, res) => {
    const db = await abrirBanco();

    const { dataInicio, dataFim, funcionario_id, procedimento_id } = req.query;

    let whereClauses = [];
    let params = [];

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

    const where = whereClauses.length ? 'WHERE ' + whereClauses.join(' AND ') : '';

    const sql = `
        SELECT 
            a.id,
            a.dia,
            a.horario,
            c.nome AS cliente_nome,
            f.nome AS funcionario_nome,
            IFNULL(SUM(p.valor), 0) AS valor_total
        FROM agendamentos a
        JOIN clientes c ON c.id = a.cliente_id
        JOIN funcionarios f ON f.id = a.funcionario_id
        LEFT JOIN agendamento_procedimentos ap ON ap.agendamento_id = a.id
        LEFT JOIN procedimentos p ON p.id = ap.procedimento_id
        ${where}
        GROUP BY a.id
        ORDER BY a.dia, a.horario
    `;

    const agendamentos = await db.all(sql, params);
    await db.close();

    // Criar o Excel
    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet('Relatório de Agendamentos');

    worksheet.columns = [
        { header: 'Cliente', key: 'cliente_nome', width: 30 },
        { header: 'Funcionário', key: 'funcionario_nome', width: 30 },
        { header: 'Data', key: 'dia', width: 15 },
        { header: 'Horário', key: 'horario', width: 10 },
        { header: 'Valor Total', key: 'valor_total', width: 15 }
    ];

    agendamentos.forEach(a => {
        worksheet.addRow({
            cliente_nome: a.cliente_nome,
            funcionario_nome: a.funcionario_nome,
            dia: a.dia,
            horario: a.horario,
            valor_total: parseFloat(a.valor_total || 0).toFixed(2)
        });
    });

    // Espaço e resumo
    worksheet.addRow([]);
    worksheet.addRow(['Resumo Financeiro']);
    worksheet.addRow(['Total de agendamentos', agendamentos.length]);
    worksheet.addRow(['Valor total', agendamentos.reduce((acc, a) => acc + (a.valor_total || 0), 0).toFixed(2)]);

    // Estilizar resumo
    const lastRow = worksheet.lastRow.number;
    worksheet.getRow(lastRow - 2).font = { bold: true };
    worksheet.getRow(lastRow - 1).font = { bold: true };
    worksheet.getRow(lastRow).font = { bold: true };

    // Exportar o arquivo
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', 'attachment; filename="relatorio-agendamentos.xlsx"');

    await workbook.xlsx.write(res);
    res.end();
});


app.post('/agendamentos/finalizar/:id', requireLogin, async (req, res) => {
  const db = await abrirBanco(); // <-- ISSO AQUI É FUNDAMENTAL
  const id = req.params.id;
  try {
    await db.run('UPDATE agendamentos SET finalizado = 1 WHERE id = ?', [id]);
    res.json({ success: true });
  } catch (error) {
    console.error('Erro ao finalizar agendamento:', error.message);
    res.json({ success: false });
  } finally {
    await db.close(); // Boa prática: fechar o banco depois
  }
});

app.get('/escolherHorarioFuncionario', requireLogin, async (req, res) => {
  const { dia, funcionario_id } = req.query;
  const db = await abrirBanco();

  const diasSemana = ['domingo', 'segunda', 'terca', 'quarta', 'quinta', 'sexta', 'sabado'];
  const diaSemana = diasSemana[new Date(dia).getDay()];

  const expediente = await db.get(`
    SELECT inicio, fim
    FROM horarios_expeds
    WHERE funcionario_id = ? AND dia_semana = ?
  `, [funcionario_id, diaSemana]);

  await db.close();
  res.json({ expediente });
});


app.post('/excluir-especialidade/:id', requireLogin, async (req, res) => {
  const db = await abrirBanco();
  const id = req.params.id;

  try {
    await db.run('DELETE FROM especialidades WHERE id = ?', [id]);
    res.redirect('/especialidades'); // volta pra lista depois de excluir
  } catch (error) {
    console.error('Erro ao excluir especialidade:', error.message);
    res.send('Erro ao excluir especialidade.');
  } finally {
    await db.close();
  }
});

app.get('/debug-expedientes', requireLogin, async (req, res) => {
  const db = await abrirBanco();
  const registros = await db.all(`SELECT * FROM horarios_expeds`);
  await db.close();
  res.json(registros);
});
// Listar procedimentos
app.get('/procedimentos', requireLogin, async (req, res) => {
  const db = await abrirBanco();
  const procedimentos = await db.all('SELECT * FROM procedimentos');
  await db.close();
  res.render('procedimentos', { procedimentos, msg: null });
});

app.get('/novo-procedimento', requireLogin, (req, res) => {
  res.render('novoProcedimento', { msg: null }); // <<< Corrigido aqui
});

app.post('/novo-procedimento', requireLogin, async (req, res) => {
  const { nome, valor, duracao } = req.body;
  const db = await abrirBanco();
  await db.run('INSERT INTO procedimentos (nome, valor, duracao) VALUES (?, ?, ?)', [nome, valor, duracao]);
  await db.close();
  res.redirect('/procedimentos?sucesso=1');
});


// Exibir formulário para editar procedimentos (tela de edição em massa)
// Rota para exibir tela de edição de procedimentos
app.get('/editar-procedimento', requireLogin, async (req, res) => {
  const db = await abrirBanco();
  const procedimentos = await db.all('SELECT * FROM procedimentos');
  await db.close();
  res.render('editarProcedimento', { procedimentos, msg: null });
});



// Salvar alterações de procedimentos
app.post('/procedimentos', requireLogin, async (req, res) => {
  const db = await abrirBanco();
  const procedimentos = await db.all('SELECT * FROM procedimentos');

  for (const p of procedimentos) {
    const novaDuracao = req.body[`duracao_${p.id}`];
    const novoValor = req.body[`valor_${p.id}`];
    if (novaDuracao !== undefined && novoValor !== undefined) {
      await db.run('UPDATE procedimentos SET duracao = ?, valor = ? WHERE id = ?', [novaDuracao, novoValor, p.id]);
    }
  }

  await db.close();
  res.render('editarProcedimento', { procedimentos, msg: 'Procedimentos atualizados com sucesso!' });
});

app.get('/excluir-procedimento/:id', requireLogin, async (req, res) => {
  const { id } = req.params;
  const db = await abrirBanco();

  try {
    await db.run('DELETE FROM procedimentos WHERE id = ?', [id]);
    await db.close();
    res.redirect('/procedimentos?sucesso=excluido'); // redireciona para a lista com SweetAlert
  } catch (error) {
    await db.close();
    res.send('Erro ao excluir procedimento: ' + error.message);
  }
});
app.get('/cadastro', (req, res) => {
  res.render('cadastro_empresa_admin', { msg: null });
});


app.post('/cadastro', async (req, res) => {
  const { nome_empresa, email_admin, senha_admin } = req.body;
  const db = await abrirBanco();

  try {
    // Verifica se o e-mail já existe na tabela empresas
    const empresaExistente = await db.get('SELECT * FROM empresas WHERE email_admin = ?', [email_admin]);

    // Verifica se o e-mail já existe na tabela usuarios
    const usuarioExistente = await db.get('SELECT * FROM usuarios WHERE email = ?', [email_admin]);

    if (empresaExistente || usuarioExistente) {
      await db.close();
      return res.render('cadastro_empresa_admin', { msg: 'Já existe uma conta com este e-mail.' });
    }

    // Cria a empresa
    const resultado = await db.run(`
      INSERT INTO empresas (nome_empresa, email_admin, senha_admin)
      VALUES (?, ?, ?)
    `, [nome_empresa, email_admin, senha_admin]);

    const empresa_id = resultado.lastID;

    // Cria o usuário administrador vinculado
    const senhaHash = await bcrypt.hash(senha_admin, 10);
    await db.run(`
      INSERT INTO usuarios (empresa_id, nome, email, senha, tipo)
      VALUES (?, ?, ?, ?, 'admin')
    `, [empresa_id, 'Administrador', email_admin, senhaHash]);

    // Envia o e-mail de boas-vindas somente se tudo foi bem-sucedido
    const { enviarEmailBoasVindas } = require('./emailService');
    await enviarEmailBoasVindas(email_admin, nome_empresa);

    await db.close();
    res.render('sucessoCadastroEmpresa'); // você pode criar essa tela de confirmação
  } catch (error) {
    console.error('Erro ao cadastrar empresa:', error);
    await db.close();
    res.render('cadastro_empresa_admin', { msg: 'Erro ao cadastrar empresa. Tente novamente mais tarde.' });
  }
});


app.get('/redefinir-senha/:token', async (req, res) => {
  const { token } = req.params;
  const db = await abrirBanco();

  const usuario = await db.get(`
    SELECT * FROM usuarios WHERE token_redefinicao = ? AND expira_token > datetime('now')
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
  const db = await abrirBanco();

  const usuario = await db.get(`
    SELECT * FROM usuarios WHERE token_redefinicao = ? AND expira_token > datetime('now')
  `, [token]);

  if (!usuario) {
    await db.close();
    return res.send('Link inválido ou expirado.');
  }

  if (senha !== confirmarSenha) {
    await db.close();
    return res.send('As senhas não coincidem.');
  }

  const senhaHash = await bcrypt.hash(senha, 10);

  await db.run(`
    UPDATE usuarios
    SET senha = ?, token_redefinicao = NULL, expira_token = NULL
    WHERE id = ?
  `, [senhaHash, usuario.id]);

  await db.close();
  res.send('Senha redefinida com sucesso! Agora você pode fazer login.');
});


app.post('/login', async (req, res) => {
  const { email, senha } = req.body;

  const db = await abrirBanco();
  try {
    const usuario = await db.get('SELECT * FROM usuarios WHERE email = ?', [email]);

    if (!usuario) {
      await db.close();
      return res.render('login', { erro: 'Usuário não encontrado.' });
    }

    const senhaCorreta = await bcrypt.compare(senha, usuario.senha);

    if (!senhaCorreta) {
      await db.close();
      return res.render('login', { erro: 'Senha incorreta.' });
    }

    req.session.usuarioLogado = usuario.email;  // ou o que quiser salvar
    req.session.tipo = usuario.tipo;
    req.session.nome_usuario = usuario.nome;
    req.session.empresa_id = usuario.empresa_id;
    
    await db.close();
    res.redirect('/agendamentos'); // ou /painel-admin, etc
    

  } catch (error) {
    await db.close();
    console.error(error);
    res.send('Erro ao fazer login: ' + error.message);
  }
});

app.post('/cadastro-empresa', async (req, res) => {
  const { nome_empresa, email_admin, senha_admin, confirmar_senha } = req.body;

  if (senha_admin !== confirmar_senha) {
    return res.render('erroCadastroEmpresa', { erro: 'As senhas não coincidem.' });
  }

  const db = await abrirBanco();
  try {
    // Verifica se o e-mail já existe em 'usuarios'
    const usuarioExistente = await db.get('SELECT * FROM usuarios WHERE email = ?', [email_admin]);
    if (usuarioExistente) {
      await db.close();
      return res.render('erroCadastroEmpresa', { erro: 'Este e-mail já está em uso para outro usuário.' });
    }

    // Criptografa a senha
    const senhaHash = await bcrypt.hash(senha_admin, 10);

    // Cria a empresa
    await db.run(`
      INSERT INTO empresas (nome_empresa, email_admin, senha_admin)
      VALUES (?, ?, ?)
    `, [nome_empresa, email_admin, senhaHash]);

    const empresaCriada = await db.get('SELECT id FROM empresas WHERE email_admin = ?', [email_admin]);

    // Cria o usuário administrador
    await db.run(`
      INSERT INTO usuarios (empresa_id, nome, email, senha, tipo)
      VALUES (?, ?, ?, ?, ?)
    `, [
      empresaCriada.id,
      'Administrador',
      email_admin,
      senhaHash,
      'admin'
    ]);

    await enviarEmailBoasVindas(email_admin, nome_empresa);

    await db.close();
    res.render('sucessoCadastroEmpresa');

  } catch (error) {
    await db.close();

    if (error.code === 'SQLITE_CONSTRAINT' && error.message.includes('email_admin')) {
      return res.render('erroCadastroEmpresa', {
        erro: 'Já existe uma empresa cadastrada com esse e-mail.'
      });
    }
    
    console.error(error);
    res.render('erroCadastroEmpresa', { erro: 'Erro ao cadastrar empresa: ' + error.message });
  }
});

  


app.get('/painel-admin', requireLogin, (req, res) => {
  res.render('painelAdmin', {
    nome_usuario: req.session.nome_usuario
  });
});

app.get('/listar-usuarios', async (req, res) => {
  const db = await abrirBanco();
  const usuarios = await db.all('SELECT * FROM usuarios');
  await db.close();
  res.json(usuarios);
});
app.get('/esqueci-senha', (req, res) => {
  res.render('esqueciSenha', { msg: null });
});

const crypto = require('crypto');
const { enviarEmailRedefinicao } = require('./emailService');

app.post('/esqueci-senha', async (req, res) => {
  const { email } = req.body;
  const db = await abrirBanco();

  const usuario = await db.get('SELECT * FROM usuarios WHERE email = ?', [email]);

  if (!usuario) {
    await db.close();
    return res.render('esqueciSenha', { msg: 'E-mail não encontrado.' });
  }

  const token = crypto.randomBytes(32).toString('hex');
  const expira = new Date(Date.now() + 1000 * 60 * 15).toISOString(); // 15 minutos

  await db.run('UPDATE usuarios SET token_redefinicao = ?, expira_token = ? WHERE id = ?', [token, expira, usuario.id]);

  await enviarEmailRedefinicao(email, token);
  await db.close();

  res.render('esqueciSenha', { msg: 'Link de redefinição enviado para seu e-mail.' });
});

app.get('/criar-senha', async (req, res) => {
  const { token } = req.query;
  const db = await abrirBanco();
  const usuario = await db.get('SELECT * FROM usuarios WHERE token_redefinicao = ?', [token]);
  await db.close();

  if (!usuario || new Date() > new Date(usuario.expira_token)) {
    return res.send('Token expirado ou inválido.');
  }

  res.render('criarSenha', { token, msg: null });
});

app.post('/criar-senha', async (req, res) => {
  const { token, novaSenha, confirmarSenha } = req.body;

  if (novaSenha !== confirmarSenha) {
    return res.render('criarSenha', { token, msg: 'As senhas não coincidem.' });
  }

  const db = await abrirBanco();
  const usuario = await db.get('SELECT * FROM usuarios WHERE token_redefinicao = ?', [token]);

  if (!usuario || new Date() > new Date(usuario.expira_token)) {
    await db.close();
    return res.send('Token expirado ou inválido.');
  }

  const novaHash = await bcrypt.hash(novaSenha, 10);
  await db.run(`
    UPDATE usuarios 
    SET senha = ?, token_redefinicao = NULL, expira_token = NULL 
    WHERE id = ?
  `, [novaHash, usuario.id]);

  await db.close();

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
          }).then((result) => {
            if (result.isConfirmed) {
              window.location.href = '/login';
            }
          });
        </script>
      </body>
    </html>
  `);
});
app.get('/verificar-email', async (req, res) => {
  const { email } = req.query;
  const db = await abrirBanco();
  const empresa = await db.get('SELECT * FROM empresas WHERE email_admin = ?', [email]);
  await db.close();

  res.json({ existe: !!empresa });
});


app.get('/', (req, res) => res.redirect('/agendamentos'));

app.listen(PORT, () => {
    console.log(`Acesse http://localhost:${PORT}`);
});
