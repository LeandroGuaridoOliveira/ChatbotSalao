const express = require('express');
const session = require('express-session');
const bcrypt = require('bcrypt');
const sqlite3 = require('sqlite3');
const { open } = require('sqlite');
const path = require('path');
const dayjs = require('dayjs'); // use `npm install dayjs` se ainda não tiver
const duration = require('dayjs/plugin/duration');
const isSameOrBefore = require('dayjs/plugin/isSameOrBefore');
dayjs.extend(isSameOrBefore);
dayjs.extend(duration);



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

  console.log("👉 CHAMADA /horarios-disponiveis");
  console.log("funcionario_id:", funcionario_id);
  console.log("dia:", dia);
  console.log("procedimentos:", procedimentos);

  if (!funcionario_id || !dia || !procedimentos) {
    return res.status(400).json({ erro: 'Dados incompletos.' });
  }

  const db = await abrirBanco();

  // Corrigido: traduzindo para português corretamente
  const diasSemana = ['domingo', 'segunda', 'terca', 'quarta', 'quinta', 'sexta', 'sabado'];
  const nomeDiaSemana = diasSemana[new Date(dia).getDay()];

  const expediente = await db.get(`
    SELECT inicio, fim FROM horarios_expeds
    WHERE funcionario_id = ? AND dia_semana = ?
  `, [funcionario_id, nomeDiaSemana]);

  if (!expediente) {
    await db.close();
    return res.json([]); // funcionário não trabalha nesse dia
  }

  const agendamentos = await db.all(`
    SELECT horario FROM agendamentos
    WHERE funcionario_id = ? AND dia = ?
  `, [funcionario_id, dia]);

  const ocupados = agendamentos.map(a => a.horario);

  const listaIds = Array.isArray(procedimentos) ? procedimentos : [procedimentos];
  const placeholders = listaIds.map(() => '?').join(',');
  const procRows = await db.all(
    `SELECT duracao FROM procedimentos WHERE id IN (${placeholders})`,
    listaIds
  );

  const duracaoTotalMin = procRows.reduce((soma, p) => soma + (p.duracao || 0), 0) + 10;
  const horariosLivres = [];
  let hora = dayjs(`${dia}T${expediente.inicio}`);
  const fim = dayjs(`${dia}T${expediente.fim}`);
  
  // Defina o salto: se a duração total for menor que 60min, pule 60min; senão pule (duraçãoTotal + 10min)
  const salto = duracaoTotalMin < 60 ? 60 : duracaoTotalMin + 10;
  
  while (hora.add(duracaoTotalMin, 'minute').isSameOrBefore(fim)) {
    const formato = hora.format('HH:mm');
  
    const horarioOcupado = ocupados.some(ocupado => {
      const inicio = dayjs(`${dia}T${ocupado}`);
      const fimOcupado = inicio.add(duracaoTotalMin, 'minute');
      return hora.isBefore(fimOcupado) && hora.add(duracaoTotalMin, 'minute').isAfter(inicio);
    });
  
    if (!horarioOcupado) {
      horariosLivres.push(formato);
    }
  
    // Pula para o próximo horário baseado no salto calculado
    hora = hora.add(salto, 'minute');
  }
  
  await db.close();
  res.json(horariosLivres);
});


function capitalizeFirst(texto) {
  return texto.charAt(0).toUpperCase() + texto.slice(1).toLowerCase();
}


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
            res.render('expedienteFuncionario', {
              funcionario,
              expediente
            });
          });
          
          app.post('/expediente-funcionario/:id', requireLogin, async (req, res) => {
            const db = await abrirBanco();
            const funcionarioId = req.params.id;
          
            const diasSemana = ["Segunda", "Terça", "Quarta", "Quinta", "Sexta", "Sábado", "Domingo"];
          
            for (const dia of diasSemana) {
              const inicio = req.body[`inicio_${dia}`];
              const fim = req.body[`fim_${dia}`];
              const ativo = req.body[`ativo_${dia}`]; // checkbox vem como 'on' se marcado
              
          
              if (ativo && inicio && fim) {
                await db.run(`
                  DELETE FROM horarios_expeds WHERE funcionario_id = ? AND dia_semana = ?
                `, [funcionarioId, dia]);
              
                await db.run(`
                  INSERT INTO horarios_expeds (funcionario_id, dia_semana, inicio, fim)
                  VALUES (?, ?, ?, ?)
                `, [funcionarioId, dia, inicio, fim]);
              } else {
                // Remove se não estiver marcado ou estiver vazio
                await db.run(`
                  DELETE FROM horarios_expeds WHERE funcionario_id = ? AND dia_semana = ?
                `, [funcionarioId, dia]);
              }
              
            }
            await db.close();
            res.redirect('/funcionarios');
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
            
              res.render('procedimentos', { procedimentos, msg });
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
            
                req.session.msg = 'Procedimentos atualizados com sucesso!';
                await db.close();
                res.redirect('/procedimentos');
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
      
        const funcionarios = await db.all('SELECT id, nome FROM funcionarios');
        const procedimentos = await db.all('SELECT id, nome FROM procedimentos');
      
        const { dataInicio, dataFim, funcionario_id, procedimento_id } = req.query;
      
        let filtros = {
          dataInicio: dataInicio || '',
          dataFim: dataFim || '',
          funcionarioId: funcionario_id || '',
          procedimentoId: procedimento_id || ''
        };
      
        let query = `
          SELECT 
            a.id, 
            a.dia, 
            a.horario, 
            c.nome AS cliente_nome, 
            f.nome AS funcionario_nome
          FROM agendamentos a
          JOIN clientes c ON c.id = a.cliente_id
          JOIN funcionarios f ON f.id = a.funcionario_id
          WHERE 1=1
        `;
        let params = [];
      
        if (dataInicio) {
          query += ' AND a.dia >= ?';
          params.push(dataInicio);
        }
      
        if (dataFim) {
          query += ' AND a.dia <= ?';
          params.push(dataFim);
        }
      
        if (funcionario_id) {
          query += ' AND a.funcionario_id = ?';
          params.push(funcionario_id);
        }
      
        if (procedimento_id) {
          query += `
            AND a.id IN (
              SELECT agendamento_id
              FROM agendamento_procedimentos
              WHERE procedimento_id = ?
            )
          `;
          params.push(procedimento_id);
        }
      
        query += ' ORDER BY a.dia, a.horario';
      
        const agendamentos = await db.all(query, params);
      
        for (const agendamento of agendamentos) {
          let procQuery = `
            SELECT p.nome, p.valor
            FROM agendamento_procedimentos ap
            JOIN procedimentos p ON p.id = ap.procedimento_id
            WHERE ap.agendamento_id = ?
          `;
          const procParams = [agendamento.id];
        
          if (procedimento_id) {
            procQuery += ' AND p.id = ?';
            procParams.push(procedimento_id);
          }
        
          const proc = await db.all(procQuery, procParams);
        
          agendamento.procedimentos = proc.map(p => `${p.nome} (R$ ${p.valor.toFixed(2)})`).join(', ');
          agendamento.valor_total = proc.reduce((total, p) => total + (p.valor || 0), 0);
        }
        
      
        await db.close();
      
        res.render('relatorios', {
          filtros,
          funcionarios,
          procedimentos,
          agendamentos
        });
      });
    
      
app.get('/', (req, res) => res.redirect('/agendamentos'));

app.listen(PORT, () => {
    console.log(`Acesse http://localhost:${PORT}`);
});
