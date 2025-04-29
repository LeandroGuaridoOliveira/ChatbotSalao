const nodemailer = require('nodemailer');

// Configuração do transportador SMTP
const transporter = nodemailer.createTransport({
  service: 'gmail',
  auth: {
    user: 'chatbotcadastro@gmail.com',      // <-- Substitua pelo seu e-mail
    pass: ' truyxbqzpbtzzfit'              // <-- Use uma senha de app do Gmail
  }
});

// Enviar e-mail de boas-vindas
async function enviarEmailBoasVindas(destinatario, nomeEmpresa) {
  try {
    const mailOptions = {
      from: '"Seu Sistema" <seuemail@gmail.com>',
      to: destinatario,
      subject: 'Bem-vindo(a) à nossa plataforma!',
      html: `
        <h2>Olá, ${nomeEmpresa}!</h2>
        <p>Seu cadastro foi realizado com sucesso.</p>
        <p>Agora você pode acessar o painel do sistema usando seu e-mail e senha cadastrados.</p>
        <p><a href="http://localhost:3000/login" style="background-color: #4CAF50; color: white; padding: 10px 20px; text-decoration: none;">Acessar Login</a></p>
        <p>Estamos felizes em ter você conosco!</p>
        <hr/>
        <p>Equipe do Sistema</p>
      `
    };

    await transporter.sendMail(mailOptions);
    console.log(`✅ E-mail de boas-vindas enviado para ${destinatario}`);
  } catch (error) {
    console.error('❌ Erro ao enviar e-mail de boas-vindas:', error);
  }
}

// Enviar e-mail de redefinição de senha
async function enviarEmailRedefinicao(destinatario, token) {
  try {
    const link = `http://localhost:3000/criar-senha?token=${token}`;

    const mailOptions = {
      from: '"Seu Sistema" <seuemail@gmail.com>',
      to: destinatario,
      subject: 'Redefinição de senha',
      html: `
        <h2>Redefinição de senha</h2>
        <p>Recebemos uma solicitação para redefinir sua senha.</p>
        <p>Clique no botão abaixo para criar uma nova senha:</p>
        <p><a href="${link}" style="background-color: #007bff; color: white; padding: 10px 20px; text-decoration: none;">Redefinir Senha</a></p>
        <p>Se não foi você quem solicitou, apenas ignore este e-mail.</p>
        <hr/>
        <p>Equipe do Sistema</p>
      `
    };

    await transporter.sendMail(mailOptions);
    console.log(`✅ E-mail de redefinição enviado para ${destinatario}`);
  } catch (error) {
    console.error('❌ Erro ao enviar e-mail de redefinição:', error);
  }
}

// Exportar as funções
module.exports = {
  enviarEmailBoasVindas,
  enviarEmailRedefinicao
};
