import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';
import { Declaration, UserProfile } from '../types';
import { DGI_LOGO_WEBP_BASE64 } from './logoBase64';

const loadImageOnCanvas = (base64Str: string): Promise<HTMLCanvasElement> => {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width = img.naturalWidth || img.width;
      canvas.height = img.naturalHeight || img.height;
      const ctx = canvas.getContext('2d');
      if (ctx) {
        ctx.drawImage(img, 0, 0);
      }
      resolve(canvas);
    };
    img.onerror = () => {
      const canvas = document.createElement('canvas');
      canvas.width = 100;
      canvas.height = 100;
      resolve(canvas);
    };
    img.src = base64Str;
  });
};

export const generateDeclarationPDF = async (declaration: Declaration, user: UserProfile) => {
  const doc = new jsPDF();
  const pageWidth = doc.internal.pageSize.getWidth();
  const margin = 20;

  // Load and decode the WebP logo onto an offscreen canvas
  const logoCanvas = await loadImageOnCanvas(DGI_LOGO_WEBP_BASE64);

  const drawOfficialDGILogo = (x: number, y: number, size: number) => {
    doc.addImage(logoCanvas, 'PNG', x - size / 2, y - size / 2, size, size);
  };

  // Header - Republic of Haiti
  doc.setFontSize(14);
  doc.setFont('helvetica', 'bold');
  doc.text('REPUBLIQUE D\'HAITI', pageWidth / 2, 20, { align: 'center' });
  
  // Draw Logo
  drawOfficialDGILogo(margin + 12, 22, 25);

  doc.setFontSize(10);
  doc.text('MINISTERE DE L\'ECONOMIE ET DES FINANCES', pageWidth / 2, 27, { align: 'center' });
  doc.text('DIRECTION GENERALE DES IMPOTS', pageWidth / 2, 32, { align: 'center' });
  
  // Divider line
  doc.setLineWidth(0.5);
  doc.line(margin, 38, pageWidth - margin, 38);

  // Document Title
  doc.setFontSize(16);
  doc.text('DECLARATION FISCALE DEFINITIVE', pageWidth / 2, 50, { align: 'center' });
  doc.setFontSize(11);
  doc.setFont('helvetica', 'normal');
  doc.text(`Référence No: ${declaration.id.toUpperCase()}`, pageWidth / 2, 58, { align: 'center' });

  // Taxpayer Information Section
  doc.setFont('helvetica', 'bold');
  doc.text('IDENTIFICATION DU CONTRIBUABLE', margin, 75);
  doc.setLineWidth(0.2);
  doc.line(margin, 77, margin + 70, 77);

  doc.setFont('helvetica', 'normal');
  const detailsY = 85;
  doc.text(`Nom / Raison Sociale : ${user.displayName}`, margin, detailsY);
  doc.text(`NIF / Matricule Fiscale : ${user.taxId || 'Non spécifié'}`, margin, detailsY + 8);
  doc.text(`Adresse : ${user.address || 'Non spécifiée'}`, margin, detailsY + 16);
  doc.text(`Téléphone : ${user.phoneNumber || 'Non spécifié'}`, margin, detailsY + 24);

  // Declaration Details Section
  doc.setFont('helvetica', 'bold');
  doc.text('DETAILS DE LA DECLARATION', margin, 125);
  doc.line(margin, 127, margin + 55, 127);

  doc.setFont('helvetica', 'normal');
  doc.text(`Type d'impôt : ${formatTaxType(declaration.taxType)}`, margin, 135);
  doc.text(`Période Fiscale : ${declaration.period}`, margin, 143);
  doc.text(`Date de soumission : ${new Date(declaration.submissionDate).toLocaleDateString('fr-FR')}`, margin, 151);
  
  const statusLabel = 
    declaration.status === 'paid' ? 'ACQUITTEE' : 
    declaration.status === 'validated' ? 'VALIDEE' : 
    declaration.status === 'pending' ? 'EN ATTENTE' : 'REJETEE';
  
  doc.setFont('helvetica', 'bold');
  doc.text(`Statut : ${statusLabel}`, pageWidth - margin - 40, 135, { align: 'right' });

  // Calculation Table
  const tableData = [
    ['Assiette Fiscale / Base imposable', `${declaration.amountDeclared.toLocaleString()} HTG`],
    ['Deductions / Exonérations', `${declaration.deductions.toLocaleString()} HTG`],
    ['Montant de l\'Impôt Calculé', `${declaration.calculatedTax.toLocaleString()} HTG`],
    ['Pénalités et Intérêts de retard', `${declaration.penalties.toLocaleString()} HTG`],
    ['MONTANT TOTAL A PAYER', `${(declaration.calculatedTax + declaration.penalties).toLocaleString()} HTG`],
  ];

  autoTable(doc, {
    startY: 165,
    head: [['Description', 'Montant']],
    body: tableData,
    theme: 'striped',
    headStyles: { fillColor: [45, 42, 112], textColor: [255, 255, 255] },
    columnStyles: {
      0: { fontStyle: 'bold' },
      1: { halign: 'right' }
    },
    styles: { fontSize: 10, cellPadding: 5 }
  });

  // Footer / Certification
  const finalY = (doc as any).lastAutoTable.finalY + 30;
  
  doc.setFontSize(10);
  doc.setFont('helvetica', 'italic');
  doc.text('Je certifie que les informations fournies dans cette déclaration sont exactes et complètes.', margin, finalY);
  
  doc.setFont('helvetica', 'normal');
  doc.text('Fait à Port-au-Prince, le ' + new Date().toLocaleDateString('fr-FR'), margin, finalY + 15);

  // Official Electronic Stamp
  const stampX = pageWidth - margin - 25;
  const stampY = finalY + 20;
  
  if (declaration.status === 'paid') {
    // Outer circle
    doc.setDrawColor(45, 42, 112); // DGI Indigo
    doc.setLineWidth(1);
    doc.circle(stampX, stampY, 22, 'S');
    
    // Inner circles
    doc.setLineWidth(0.4);
    doc.circle(stampX, stampY, 19, 'S');
    doc.circle(stampX, stampY, 14, 'S');
    
    // DGI Logo in the very center of the seal
    drawOfficialDGILogo(stampX, stampY, 16);

    // Circular-like text
    doc.setFontSize(5);
    doc.setTextColor(45, 42, 112);
    doc.setFont('helvetica', 'bold');
    
    // Top text - Direction Generale
    doc.text('DIRECTION GENERALE', stampX, stampY - 15.5, { align: 'center' });
    doc.text('DES IMPOTS', stampX, stampY - 12.5, { align: 'center' });
    
    // Bottom text - Republique d'Haiti
    doc.text('REPUBLIQUE D\'HAITI', stampX, stampY + 16, { align: 'center' });
    
    // Diagonal "ACQUITTÉ"
    doc.setFontSize(10);
    doc.setTextColor(45, 42, 112);
    doc.text('ACQUITTÉ', stampX, stampY + 2, { align: 'center', angle: 15 });
    
    // Date below
    doc.setFontSize(6);
    const payDate = declaration.paymentDate ? new Date(declaration.paymentDate) : new Date();
    doc.text(payDate.toLocaleDateString('fr-FR'), stampX, stampY + 7, { align: 'center', angle: 15 });

    // Official verification text
    doc.setTextColor(100, 100, 100);
    doc.setFont('helvetica', 'italic');
    doc.setFontSize(7);
    doc.text('Document certifié conforme par la DGI-Haiti', pageWidth - margin, finalY + 50, { align: 'right' });
    doc.setFont('courier', 'normal');
    doc.setFontSize(6);
    doc.text(`Transaction ID: ${declaration.id.substring(0, 12).toUpperCase()}`, pageWidth - margin, finalY + 54, { align: 'right' });
  } else {
    // Placeholder for non-paid
    doc.setDrawColor(200, 200, 200);
    doc.setLineDashPattern([2, 1], 0);
    doc.rect(pageWidth - margin - 50, finalY + 5, 40, 40);
    doc.setFontSize(8);
    doc.setTextColor(150, 150, 150);
    doc.text('EN ATTENTE', pageWidth - margin - 30, finalY + 22, { align: 'center' });
    doc.text('DE PAIEMENT', pageWidth - margin - 30, finalY + 28, { align: 'center' });
    doc.setLineDashPattern([], 0);
  }

  // Bottom Notice
  doc.setFontSize(7);
  doc.setTextColor(150, 150, 150);
  doc.text('Ceci est un document généré électroniquement par le portail e-Fiscalité Haïti.', pageWidth / 2, 285, { align: 'center' });

  // Save the PDF
  doc.save(`declaration_${declaration.id.substring(0, 8)}.pdf`);
};

function formatTaxType(type: string): string {
  const map: Record<string, string> = {
    patente: "Patente",
    impot_revenu: "Impôt sur le Revenu",
    tva: "TVA / TCA",
    taxe_locative: "Contribution Foncière (CFPB)",
    matricule_fiscale: "Matricule Fiscale (NIF)",
    quitus: "Le Quitus Fiscal",
    amende_retard: "Pénalité pour Retard",
    amende_circulation: "Amende Circulation",
    penalite_fiscale: "Pénalités Fiscales"
  };
  return map[type] || type.replace(/_/g, ' ');
}
