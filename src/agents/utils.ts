/**
 * Retorna uma mensagem estruturada com informações sobre data e hora atual e projeções futuras
 * @returns {string} Mensagem formatada com informações de data e hora
 */
export function getInformacaoDataHora(): string {
  // Data e hora atual
  const dataAtual = new Date();
  
  // Data de hoje (apenas a data, sem a hora)
  const dataHoje = new Date();
  dataHoje.setHours(0, 0, 0, 0);
  
  // Data de 7 dias na frente
  const dataSeteDias = new Date();
  dataSeteDias.setDate(dataAtual.getDate() + 7);
  
  // Data de 1 mês na frente
  const dataUmMes = new Date();
  dataUmMes.setMonth(dataAtual.getMonth() + 1);
  
  // Primeiro dia da semana que vem
  const primeiroDiaSemanaQueVem = new Date();
  const diaAtual = primeiroDiaSemanaQueVem.getDay(); // 0 (Domingo) até 6 (Sábado)
  const diasAteProximoDomingo = 7 - diaAtual;
  primeiroDiaSemanaQueVem.setDate(primeiroDiaSemanaQueVem.getDate() + diasAteProximoDomingo);
  
  // Formatação das datas em português
  const formatarData = (data: Date): string => {
    return data.toLocaleDateString('pt-BR', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric'
    });
  };
  
  const formatarDataHora = (data: Date): string => {
    return data.toLocaleDateString('pt-BR', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit'
    });
  };
  
  // Montando a mensagem
  const mensagem = `
📅 Informações de Data e Hora:
───────────────────────────
✓ Data e hora atual: ${formatarDataHora(dataAtual)}
✓ Data de hoje: ${formatarData(dataHoje)}
✓ Data daqui 7 dias: ${formatarData(dataSeteDias)}
✓ Data daqui 1 mês: ${formatarData(dataUmMes)}
✓ Primeiro dia da próxima semana: ${formatarData(primeiroDiaSemanaQueVem)}
───────────────────────────
  `.trim();
  
  return mensagem;
}
