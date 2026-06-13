export type UserRole = 'citizen' | 'business' | 'dgi_agent' | 'admin';

export interface UserProfile {
  uid: string;
  displayName: string;
  email: string;
  role: UserRole;
  taxId?: string;
  phoneNumber?: string;
  address?: string;
  createdAt: string;
}

export type TaxType = 
  | 'patente' 
  | 'impot_revenu' 
  | 'tva' 
  | 'taxe_locative' 
  | 'licence_etranger' 
  | 'droit_fonctionnement' 
  | 'droit_non_fonctionnement' 
  | 'cfgdct' 
  | 'cas' 
  | 'fonds_urgence' 
  | 'identite_pro' 
  | 'matricule_fiscale' 
  | 'permis_conduire' 
  | 'legalisation_pieces' 
  | 'lacompte_provisionnel'
  | 'retenues_source'
  | 'amende_retard'
  | 'amende_circulation'
  | 'penalite_fiscale'
  | 'quitus';

export interface Declaration {
  id: string;
  userId: string;
  taxType: TaxType;
  period: string;
  amountDeclared: number;
  calculatedTax: number;
  penalties: number;
  deductions: number;
  calcDetails: {
    masseSalariale: number;
    communeGroup: number;
    isFurnished: boolean;
    newBuildYear: number;
  };
  status: 'pending' | 'validated' | 'paid' | 'rejected';
  submissionDate: string;
  paymentDate?: string;
  notes?: string;
}

export interface Payment {
  id: string;
  declarationId: string;
  userId: string;
  amount: number;
  method: 'moncash' | 'natcash' | 'credit_card' | 'debit_card' | 'paypal' | 'bank_transfer' | 'card' | 'mobile_money';
  transactionRef: string;
  status: 'pending' | 'completed' | 'failed';
  paymentDate: string;
}
