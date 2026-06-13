import React, { useState, useEffect } from 'react';
import { 
  getAuth, 
  signInWithPopup, 
  GoogleAuthProvider, 
  signOut, 
  onAuthStateChanged,
  User
} from 'firebase/auth';
import { 
  doc, 
  getDoc, 
  setDoc, 
  collection, 
  addDoc, 
  query, 
  where, 
  onSnapshot,
  orderBy,
  Timestamp,
  getDocFromServer
} from 'firebase/firestore';
import { db, auth } from './firebase';
import { UserProfile, Declaration, Payment, TaxType } from './types';
import { 
  LayoutDashboard, 
  FileText, 
  CreditCard, 
  MessageSquare, 
  LogOut, 
  ShieldCheck, 
  AlertCircle,
  Menu,
  X,
  ChevronRight,
  Plus,
  History,
  Languages,
  Download,
  User as UserIcon
} from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { getFiscalAssistance } from './services/geminiService';
import { generateDeclarationPDF } from './utils/pdfGenerator';
import { DGI_LOGO_WEBP_BASE64 } from './utils/logoBase64';
import ReactMarkdown from 'react-markdown';
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

// Utility for tailwind classes
function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

// Helper to format numbers with commas for input display
const formatNumericInput = (value: string | number) => {
  if (value === '' || value === undefined || value === null || (typeof value === 'number' && isNaN(value))) return '';
  const numString = value.toString().replace(/[^0-9]/g, '');
  if (!numString) return '';
  return numString.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
};

// Helper to parse formatted string back to number
const parseFormattedNumber = (formatted: string) => {
  const raw = formatted.replace(/,/g, '');
  if (!raw) return 0;
  const num = parseInt(raw, 10);
  return isNaN(num) ? 0 : num;
};

// --- Error Handling ---
enum OperationType {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  LIST = 'list',
  GET = 'get',
  WRITE = 'write',
}

function handleFirestoreError(error: unknown, operationType: OperationType, path: string | null) {
  const errInfo = {
    error: error instanceof Error ? error.message : String(error),
    authInfo: {
      userId: auth.currentUser?.uid,
      email: auth.currentUser?.email,
      emailVerified: auth.currentUser?.emailVerified,
    },
    operationType,
    path
  };
  console.error('Firestore Error: ', JSON.stringify(errInfo));
  throw new Error(JSON.stringify(errInfo));
}

// --- Constants for Tax Calculations (Based on DGI Guide) ---
const DDIR_BRACKETS = [
  { limit: 60000, rate: 0 },
  { limit: 240000, rate: 0.10 },
  { limit: 480000, rate: 0.15 },
  { limit: 1000000, rate: 0.25 },
  { limit: Infinity, rate: 0.30 }
];

const CFPB_BRACKETS = [
  { limit: 50000, rate: 0.06 },
  { limit: 100000, rate: 0.07 },
  { limit: 150000, rate: 0.08 },
  { limit: 200000, rate: 0.09 },
  { limit: Infinity, rate: 0.10 }
];

const calculateDDIR = (income: number, deductions: number = 0) => {
  const taxableIncome = Math.max(0, income - deductions);
  let tax = 0;
  let previousLimit = 0;
  for (const bracket of DDIR_BRACKETS) {
    const taxableInBracket = Math.min(taxableIncome - previousLimit, bracket.limit - previousLimit);
    if (taxableInBracket <= 0) break;
    tax += taxableInBracket * bracket.rate;
    previousLimit = bracket.limit;
    if (taxableIncome <= bracket.limit) break;
  }
  return tax;
};

const calculateCFPB = (rentalValue: number, isFurnished: boolean = false, newBuildYear: number = 0) => {
  let tax = 0;
  let previousLimit = 0;
  for (const bracket of CFPB_BRACKETS) {
    const taxableInBracket = Math.min(rentalValue - previousLimit, bracket.limit - previousLimit);
    if (taxableInBracket <= 0) break;
    tax += taxableInBracket * bracket.rate;
    previousLimit = bracket.limit;
    if (rentalValue <= bracket.limit) break;
  }

  // Reductions
  if (isFurnished) tax *= 0.67; // Max 1/3 reduction
  if (newBuildYear === 1) tax *= 0.25; // 75% reduction
  else if (newBuildYear === 2) tax *= 0.50; // 50% reduction
  else if (newBuildYear === 3) tax *= 0.75; // 25% reduction

  return tax;
};

const calculatePatente = (group: number, ca: number, masseSalariale: number, entityType: 'standard' | 'ong' | 'parti' = 'standard') => {
  if (entityType === 'ong') return 50000;
  if (entityType === 'parti') return 100000;
  
  const df = group === 1 ? 5000 : group === 2 ? 2500 : 1250;
  const dv = Math.max(0, (ca - masseSalariale) * 0.004);
  return df + dv;
};

const formatTaxType = (type: TaxType) => {
  const map: Record<TaxType, string> = {
    patente: "Contribution des Patentes",
    impot_revenu: "Déclaration Définitive d'Impôt sur le Revenu",
    tva: "Taxe sur le Chiffre d'Affaires (TCA)",
    taxe_locative: "Contribution Foncière des Propriétés Bâties (CFPB)",
    licence_etranger: "Droit de Licence des Étrangers",
    droit_fonctionnement: "Droit de Fonctionnement",
    droit_non_fonctionnement: "Droit de Non-Fonctionnement",
    cfgdct: "Fonds de Gestion & Développement (CFGDCT)",
    cas: "Caisse d'Assistance Sociale (CAS)",
    fonds_urgence: "Le Fonds d'Urgence",
    identite_pro: "Carte d'Identité Professionnelle",
    matricule_fiscale: "Matricule Fiscale (NIF)",
    permis_conduire: "Taxe Permis de Conduire",
    legalisation_pieces: "Légalisation de Pièces",
    lacompte_provisionnel: "Acompte Provisionnel sur l'Impôt",
    retenues_source: "Les Retenues à la Source",
    amende_retard: "Pénalité pour Retard",
    amende_circulation: "Amende Record Circulation",
    penalite_fiscale: "Pénalités de Taxation",
    quitus: "Le Quitus Fiscal"
  };
  return map[type] || type.replace(/_/g, ' ');
};

const formatPaymentMethod = (method: Payment['method']) => {
  const map: Record<string, string> = {
    moncash: "MonCash",
    natcash: "Natcash",
    credit_card: "Carte de Crédit",
    debit_card: "Carte de Débit",
    paypal: "PayPal",
    bank_transfer: "Virement Bancaire",
    card: "Carte",
    mobile_money: "Paiement Mobile"
  };
  return map[method] || method.replace(/_/g, ' ');
};

// --- Components ---

const Navbar = ({ user, onSignOut, toggleSidebar }: { user: UserProfile | null, onSignOut: () => void, toggleSidebar: () => void }) => (
  <nav className="bg-white border-b border-slate-200 h-16 flex items-center justify-between px-4 md:px-8 sticky top-0 z-50">
    <div className="flex items-center gap-4">
      <button onClick={toggleSidebar} className="md:hidden p-2 hover:bg-slate-100 rounded-lg">
        <Menu className="w-6 h-6 text-slate-600" />
      </button>
      <div className="flex items-center gap-2">
        <div className="bg-white p-1 rounded-lg border border-slate-200 shadow-sm relative overflow-hidden flex items-center justify-center">
          <img src={DGI_LOGO_WEBP_BASE64} alt="DGI Logo" className="w-8 h-8 object-contain" />
        </div>
        <span className="font-bold text-xl text-slate-900 tracking-tight">e-Fiscalité</span>
      </div>
    </div>
    
    <div className="flex items-center gap-4">
      <div className="hidden md:flex items-center gap-2 text-sm text-slate-500 mr-4">
        <Languages className="w-4 h-4" />
        <span>FR / HT</span>
      </div>
      {user && (
        <div className="flex items-center gap-3">
          <div className="hidden md:block text-right">
            <p className="text-sm font-medium text-slate-900 leading-none">{user.displayName}</p>
            <p className="text-xs text-slate-500 mt-1 uppercase tracking-wider">{user.role}</p>
          </div>
          <button 
            onClick={onSignOut}
            className="p-2 hover:bg-slate-100 rounded-full text-slate-600 transition-colors"
            title="Déconnexion"
          >
            <LogOut className="w-5 h-5" />
          </button>
        </div>
      )}
    </div>
  </nav>
);

const Sidebar = ({ activeTab, setActiveTab, isOpen, setIsOpen }: { activeTab: string, setActiveTab: (tab: string) => void, isOpen: boolean, setIsOpen: (open: boolean) => void }) => {
  const menuItems = [
    { id: 'dashboard', label: 'Tableau de bord', icon: LayoutDashboard },
    { id: 'declarations', label: 'Mes Déclarations', icon: FileText },
    { id: 'amendes', label: 'Amendes & Sanctions', icon: AlertCircle },
    { id: 'payments', label: 'Paiements & Reçus', icon: CreditCard },
    { id: 'quitus', label: 'Quitus Fiscal', icon: ShieldCheck },
    { id: 'calendar', label: 'Calendrier Fiscal', icon: History },
    { id: 'assistant', label: 'Assistant Fiscal', icon: MessageSquare },
    { id: 'profile', label: 'Mon Profil', icon: UserIcon },
  ];

  return (
    <>
      <AnimatePresence>
        {isOpen && (
          <motion.div 
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={() => setIsOpen(false)}
            className="fixed inset-0 bg-slate-900/50 backdrop-blur-sm z-40 md:hidden"
          />
        )}
      </AnimatePresence>
      
      <aside className={cn(
        "fixed md:sticky top-16 left-0 h-[calc(100vh-64px)] w-64 bg-white border-r border-slate-200 z-40 transition-transform duration-300 ease-in-out md:translate-x-0",
        isOpen ? "translate-x-0" : "-translate-x-full"
      )}>
        <div className="p-4 space-y-2">
          {menuItems.map((item) => (
            <button
              key={item.id}
              onClick={() => {
                setActiveTab(item.id);
                setIsOpen(false);
              }}
              className={cn(
                "w-full flex items-center gap-3 px-4 py-3 rounded-xl text-sm font-medium transition-all duration-200",
                activeTab === item.id 
                  ? "bg-red-50 text-haiti-red shadow-sm" 
                  : "text-slate-600 hover:bg-slate-50 hover:text-slate-900"
              )}
            >
              <item.icon className={cn("w-5 h-5", activeTab === item.id ? "text-haiti-red" : "text-slate-400")} />
              {item.label}
            </button>
          ))}
        </div>
        
        <div className="absolute bottom-0 left-0 w-full p-4 border-t border-slate-100">
          <div className="bg-slate-50 rounded-xl p-4">
            <p className="text-xs font-semibold text-slate-500 uppercase tracking-widest mb-1">DGI Haïti</p>
            <p className="text-[10px] text-slate-400 leading-relaxed">
              Pour toute assistance, contactez le centre d'appel au 888-DGI.
            </p>
          </div>
        </div>
      </aside>
    </>
  );
};

const DashboardHome = ({ user, declarations }: { user: UserProfile, declarations: Declaration[] }) => {
  const pendingCount = declarations.filter(d => d.status === 'pending').length;
  const totalPaid = declarations.filter(d => d.status === 'paid').reduce((acc, curr) => acc + curr.calculatedTax, 0);

  return (
    <div className="space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-700">
      <header>
        <h1 className="text-3xl font-bold text-slate-900 tracking-tight">Bonjour, {user.displayName}</h1>
        <p className="text-slate-500 mt-2">Bienvenue sur votre espace fiscal sécurisé. Voici un aperçu de votre situation.</p>
      </header>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm hover:shadow-md transition-shadow">
          <div className="flex items-center gap-4">
            <div className="bg-red-100 p-3 rounded-xl">
              <AlertCircle className="w-6 h-6 text-haiti-red" />
            </div>
            <div>
              <p className="text-sm font-medium text-slate-500">Déclarations en attente</p>
              <p className="text-2xl font-bold text-slate-900">{pendingCount}</p>
            </div>
          </div>
        </div>
        
        <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm hover:shadow-md transition-shadow">
          <div className="flex items-center gap-4">
            <div className="bg-blue-100 p-3 rounded-xl">
              <CreditCard className="w-6 h-6 text-haiti-blue" />
            </div>
            <div>
              <p className="text-sm font-medium text-slate-500">Total payé (HTG)</p>
              <p className="text-2xl font-bold text-slate-900">{totalPaid.toLocaleString()}</p>
            </div>
          </div>
        </div>

        <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm hover:shadow-md transition-shadow">
          <div className="flex items-center gap-4">
            <div className="bg-red-100 p-3 rounded-xl">
              <FileText className="w-6 h-6 text-haiti-red" />
            </div>
            <div>
              <p className="text-sm font-medium text-slate-500">NIF / Matricule</p>
              <p className="text-2xl font-bold text-slate-900 font-mono">{user.taxId || 'Non défini'}</p>
            </div>
          </div>
        </div>
      </div>

      <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
        <div className="p-6 border-b border-slate-100 flex items-center justify-between">
          <h2 className="font-bold text-slate-900">Activités récentes</h2>
          <button className="text-sm text-haiti-blue font-medium hover:underline">Voir tout</button>
        </div>
        <div className="divide-y divide-slate-100">
          {declarations.length > 0 ? (
            declarations.slice(0, 5).map((d) => (
              <div key={d.id} className="p-4 flex items-center justify-between hover:bg-slate-50 transition-colors">
                <div className="flex items-center gap-4">
                  <div className="bg-slate-100 p-2 rounded-lg">
                    <FileText className="w-5 h-5 text-slate-500" />
                  </div>
                  <div>
                    <p className="text-sm font-bold text-slate-900 uppercase">{formatTaxType(d.taxType)}</p>
                    <p className="text-xs text-slate-500">Période: {d.period}</p>
                  </div>
                </div>
                <div className="text-right">
                  <p className="text-sm font-semibold text-slate-900">{d.calculatedTax.toLocaleString()} HTG</p>
                  <span className={cn(
                    "inline-block px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider mt-1",
                    d.status === 'paid' ? "bg-blue-100 text-haiti-blue" :
                    d.status === 'pending' ? "bg-amber-100 text-amber-700" :
                    "bg-slate-100 text-slate-700"
                  )}>
                    {d.status}
                  </span>
                </div>
              </div>
            ))
          ) : (
            <div className="p-12 text-center">
              <p className="text-slate-400">Aucune activité récente.</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

const DeclarationForm = ({ onCancel, onSuccess, mode = 'tax' }: { onCancel: () => void, onSuccess: () => void, mode?: 'tax' | 'fine' }) => {
  const [loading, setLoading] = useState(false);
  const [formData, setFormData] = useState({
    taxType: (mode === 'fine' ? 'amende_retard' : 'patente') as any,
    period: new Date().getFullYear().toString(),
    amountDeclared: 0,
    masseSalariale: 0,
    communeGroup: 1,
    entityType: 'standard' as 'standard' | 'ong' | 'parti',
    deductions: 0,
    isFurnished: false,
    newBuildYear: 0, // 0: No, 1: 1st, 2: 2nd, 3: 3rd
    notes: ''
  });

  const getTaxEstimation = (type: any, amount: number, deductions: number, isFurnished: boolean, newBuildYear: number, communeGroup: number, masseSalariale: number, entityType: any) => {
    switch (type) {
      case 'impot_revenu': return calculateDDIR(amount, deductions);
      case 'taxe_locative': return calculateCFPB(amount, isFurnished, newBuildYear);
      case 'patente': return calculatePatente(communeGroup, amount, masseSalariale, entityType);
      case 'tva': return amount * 0.10;
      case 'cas': return amount * 0.02;
      case 'cfgdct': return amount * 0.01;
      case 'licence_etranger': return 5000;
      case 'droit_fonctionnement': return 1000;
      case 'matricule_fiscale': return 500;
      case 'identite_pro': return 2500;
      case 'quitus': return 2500;
      case 'permis_conduire': return 1500;
      case 'legalisation_pieces': return 500;
      case 'lacompte_provisionnel': return amount * 0.02;
      case 'retenues_source': return amount * 0.05;
      case 'amende_retard': return amount * 0.05;
      case 'amende_circulation': return amount > 0 ? amount : 1000;
      case 'penalite_fiscale': return amount * 0.10;
      default: return amount * 0.10;
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!auth.currentUser) return;
    
    setLoading(true);
    try {
      const calculatedTax = getTaxEstimation(
        formData.taxType, 
        formData.amountDeclared, 
        formData.deductions, 
        formData.isFurnished, 
        formData.newBuildYear, 
        formData.communeGroup, 
        formData.masseSalariale, 
        formData.entityType
      );

      const newDeclaration = {
        userId: auth.currentUser.uid,
        taxType: formData.taxType,
        period: formData.period,
        amountDeclared: formData.amountDeclared,
        deductions: formData.deductions,
        calcDetails: {
          masseSalariale: formData.masseSalariale,
          communeGroup: formData.communeGroup,
          isFurnished: formData.isFurnished,
          newBuildYear: formData.newBuildYear
        },
        calculatedTax,
        penalties: 0,
        status: 'pending',
        submissionDate: new Date().toISOString(),
        notes: formData.notes
      };
      
      await addDoc(collection(db, 'declarations'), newDeclaration);
      onSuccess();
    } catch (error) {
      handleFirestoreError(error, OperationType.CREATE, 'declarations');
    } finally {
      setLoading(false);
    }
  };

  const estimatedTax = getTaxEstimation(
    formData.taxType, 
    formData.amountDeclared, 
    formData.deductions, 
    formData.isFurnished, 
    formData.newBuildYear, 
    formData.communeGroup, 
    formData.masseSalariale, 
    formData.entityType
  );

  return (
    <div className="bg-white p-8 rounded-2xl border border-slate-200 shadow-xl max-w-2xl mx-auto animate-in fade-in zoom-in-95 duration-300">
      <div className="flex items-center gap-3 mb-6">
        <div className={cn(
          "p-2 rounded-lg text-white",
          mode === 'fine' ? "bg-amber-500" : "bg-haiti-red"
        )}>
          {mode === 'fine' ? <AlertCircle className="w-6 h-6" /> : <FileText className="w-6 h-6" />}
        </div>
        <h2 className="text-2xl font-bold text-slate-900">
          {mode === 'fine' ? "Paiement d'Amende" : "Nouvelle Déclaration"}
        </h2>
      </div>

      <form onSubmit={handleSubmit} className="space-y-6">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <div className="space-y-2">
            <label className="text-sm font-semibold text-slate-700">
              {mode === 'fine' ? "Nature de l'amende" : "Type d'impôt"}
            </label>
            <select 
              value={formData.taxType}
              onChange={(e) => setFormData({...formData, taxType: e.target.value as any})}
              className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 focus:ring-2 focus:ring-haiti-blue outline-none transition-all"
            >
              {mode === 'fine' ? (
                <optgroup label="Amendes & Sanctions (Penalties)">
                  <option value="amende_retard">Pénalité de Retard</option>
                  <option value="amende_circulation">Amende de Circulation</option>
                  <option value="penalite_fiscale">Autres Pénalités Fiscales</option>
                </optgroup>
              ) : (
                <>
                  <optgroup label="Impôts & Fiscalité (Taxes)">
                    <option value="patente">La Patente (Contribution)</option>
                    <option value="impot_revenu">Déclaration Définitive d'Impôt (DDIR)</option>
                    <option value="lacompte_provisionnel">Acompte Provisionnel (IR)</option>
                    <option value="retenues_source">Retenues à la Source</option>
                    <option value="tva">Taxe sur le Chiffre d'Affaires (TCA)</option>
                    <option value="taxe_locative">Contribution Foncière (CFPB)</option>
                    <option value="cas">Caisse d'Assistance Sociale (CAS)</option>
                    <option value="cfgdct">Collectivités Territoriales (CFGDCT)</option>
                    <option value="fonds_urgence">Le Fonds d'Urgence</option>
                  </optgroup>
                  <optgroup label="Droits & Redevances (Duties)">
                    <option value="droit_fonctionnement">Le Droit de Fonctionnement</option>
                    <option value="licence_etranger">Droit de Licence des Étrangers</option>
                    <option value="droit_non_fonctionnement">Droit de Non-Fonctionnement</option>
                  </optgroup>
                  <optgroup label="Services & Cartes (Administrative)">
                    <option value="matricule_fiscale">La Matricule Fiscale (NIF)</option>
                    <option value="identite_pro">Carte d'Identité Professionnelle</option>
                    <option value="permis_conduire">Taxe Permis de Conduire</option>
                    <option value="quitus">Le Quitus Fiscal</option>
                    <option value="legalisation_pieces">La Légalisation des Pièces</option>
                  </optgroup>
                </>
              )}
            </select>
          </div>
          <div className="space-y-2">
            <label className="text-sm font-semibold text-slate-700">Période Fiscale</label>
            <input 
              type="text" 
              placeholder="Ex: 2025"
              value={formData.period}
              onChange={(e) => setFormData({...formData, period: e.target.value})}
              className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 focus:ring-2 focus:ring-haiti-blue outline-none transition-all font-mono"
              required
            />
          </div>
        </div>

        {formData.taxType === 'impot_revenu' && (
          <div className="p-4 bg-red-50/50 rounded-xl border border-red-100 space-y-4">
            <div className="space-y-2">
              <label className="text-sm font-semibold text-slate-700">Déductions Légales Totales (HTG)</label>
              <input 
                type="text"
                value={formatNumericInput(formData.deductions)}
                onChange={(e) => {
                  const rawValue = parseFormattedNumber(e.target.value);
                  setFormData({...formData, deductions: rawValue});
                }}
                className="w-full bg-white border border-slate-200 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-haiti-red outline-none"
                placeholder="Ex: 20,000"
              />
              <p className="text-[10px] text-slate-400">Voir guide DGI pour les plafonds autorisés.</p>
            </div>
          </div>
        )}

        {formData.taxType === 'taxe_locative' && (
          <div className="p-4 bg-amber-50/50 rounded-xl border border-amber-100 space-y-4">
            <div className="flex items-center gap-2">
              <input 
                type="checkbox"
                id="isFurnished"
                checked={formData.isFurnished}
                onChange={(e) => setFormData({...formData, isFurnished: e.target.checked})}
                className="w-4 h-4 rounded border-slate-300 text-haiti-red focus:ring-haiti-red"
              />
              <label htmlFor="isFurnished" className="text-sm font-semibold text-slate-700">Logement meublé (Réduction 1/3)</label>
            </div>
            <div className="space-y-2">
              <label className="text-sm font-semibold text-slate-700">Année de nouvelle construction (Hors PAP)</label>
              <select 
                value={formData.newBuildYear}
                onChange={(e) => setFormData({...formData, newBuildYear: Number(e.target.value)})}
                className="w-full bg-white border border-slate-200 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-haiti-blue outline-none"
              >
                <option value={0}>Non applicable</option>
                <option value={1}>1ère année (Réduction 75%)</option>
                <option value={2}>2ème année (Réduction 50%)</option>
                <option value={3}>3ème année (Réduction 25%)</option>
              </select>
            </div>
          </div>
        )}

        {formData.taxType === 'patente' && (
          <div className="p-4 bg-blue-50/50 rounded-xl border border-blue-100 space-y-4">
            <div className="space-y-2">
              <label className="text-sm font-semibold text-slate-700">Type d'entité</label>
              <select 
                value={formData.entityType}
                onChange={(e) => setFormData({...formData, entityType: e.target.value as any})}
                className="w-full bg-white border border-slate-200 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-haiti-blue outline-none"
              >
                <option value="standard">Entreprise / Individuel</option>
                <option value="ong">ONG / Association (Fixe 50 000 G)</option>
                <option value="parti">Parti Politique (Fixe 100 000 G)</option>
              </select>
            </div>
            {formData.entityType === 'standard' && (
              <>
                <div className="space-y-2">
                  <label className="text-sm font-semibold text-slate-700">Groupe de commune</label>
                  <select 
                    value={formData.communeGroup}
                    onChange={(e) => setFormData({...formData, communeGroup: Number(e.target.value)})}
                    className="w-full bg-white border border-slate-200 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-haiti-blue outline-none"
                  >
                    <option value={1}>Groupe 1 (PAP, Pétion-Ville, Carrefour...) - 5000 G</option>
                    <option value={2}>Groupe 2 (Gonaïves, Jacmel, Cap-Haïtien...) - 2500 G</option>
                    <option value={3}>Groupe 3 (Autres communes) - 1250 G</option>
                  </select>
                </div>
                <div className="space-y-2">
                  <label className="text-sm font-semibold text-slate-700">Masse Salariale Annuelle (HTG)</label>
                  <input 
                    type="text"
                    value={formatNumericInput(formData.masseSalariale)}
                    onChange={(e) => {
                      const rawValue = parseFormattedNumber(e.target.value);
                      setFormData({...formData, masseSalariale: rawValue});
                    }}
                    className="w-full bg-white border border-slate-200 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-haiti-blue outline-none"
                    placeholder="Montant total des salaires payés"
                  />
                </div>
              </>
            )}
          </div>
        )}

        <div className="space-y-2">
          <label className="text-sm font-semibold text-slate-700">
            {formData.taxType === 'impot_revenu' ? 'Revenu Global Brut Annuel (HTG)' :
             formData.taxType === 'patente' ? 'Chiffre d’Affaires Net Annuel (HTG)' :
             formData.taxType === 'taxe_locative' ? 'Valeur Locative Annuelle Estimée (HTG)' :
             ['tva', 'cas', 'cfgdct', 'amende_retard', 'penalite_fiscale'].includes(formData.taxType) ? 'Assiette Fiscale / Montant de Base (HTG)' :
             ['matricule_fiscale', 'quitus', 'legalisation_pieces', 'identite_pro', 'permis_conduire', 'amende_circulation'].includes(formData.taxType) ? 'Nombre d\'unités ou Frais Fixes' :
             'Montant Brut Déclaré (HTG)'}
          </label>
          <input 
            type="text" 
            value={formatNumericInput(formData.amountDeclared)}
            onChange={(e) => {
              const rawValue = parseFormattedNumber(e.target.value);
              setFormData({...formData, amountDeclared: rawValue});
            }}
            className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 focus:ring-2 focus:ring-haiti-blue outline-none transition-all font-bold text-lg"
            required
          />
          <div className="bg-slate-100 p-3 rounded-lg flex items-center justify-between border border-slate-200">
             <span className="text-xs font-bold text-slate-500 uppercase tracking-widest">Estimation de l'impôt net</span>
             <span className="text-sm font-black text-haiti-blue">
               {estimatedTax.toLocaleString()} HTG
             </span>
          </div>
        </div>

        <div className="space-y-2">
          <label className="text-sm font-semibold text-slate-700">Notes additionnelles</label>
          <textarea 
            rows={3}
            value={formData.notes}
            onChange={(e) => setFormData({...formData, notes: e.target.value})}
            className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 focus:ring-2 focus:ring-haiti-blue outline-none transition-all"
            placeholder="Précisions sur votre activité..."
          />
        </div>

        <div className="flex gap-4 pt-4">
          <button 
            type="button"
            onClick={onCancel}
            className="flex-1 px-6 py-3 border border-slate-200 rounded-xl font-bold text-slate-600 hover:bg-slate-50 transition-all"
          >
            Annuler
          </button>
          <button 
            type="submit"
            disabled={loading}
            className="flex-1 px-6 py-3 bg-haiti-red text-white rounded-xl font-bold hover:bg-red-700 shadow-lg shadow-red-200 transition-all disabled:opacity-50"
          >
            {loading ? 'Traitement...' : 'Soumettre'}
          </button>
        </div>
      </form>
    </div>
  );
};

const Chatbot = () => {
  const [messages, setMessages] = useState<{ role: 'user' | 'ai', text: string }[]>([
    { role: 'ai', text: 'Bonjour ! Je suis votre assistant e-Fiscalité. Comment puis-je vous aider aujourd\'hui ? (Mwen ka pale kreyòl tou !)' }
  ]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSend = async () => {
    if (!input.trim() || loading) return;
    
    const userMsg = input;
    setInput('');
    setMessages(prev => [...prev, { role: 'user', text: userMsg }]);
    setLoading(true);

    try {
      const response = await getFiscalAssistance(userMsg);
      setMessages(prev => [...prev, { role: 'ai', text: response || "Je n'ai pas pu générer de réponse." }]);
    } catch (error) {
      setMessages(prev => [...prev, { role: 'ai', text: "Une erreur est survenue." }]);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="bg-white rounded-2xl border border-slate-200 shadow-xl flex flex-col h-[600px] max-w-2xl mx-auto overflow-hidden">
      <div className="bg-haiti-red p-4 text-white flex items-center gap-3">
        <div className="bg-white/20 p-2 rounded-lg">
          <MessageSquare className="w-5 h-5" />
        </div>
        <div>
          <h3 className="font-bold">Assistant Fiscal IA</h3>
          <p className="text-[10px] opacity-80 uppercase tracking-widest">Disponible 24/7</p>
        </div>
      </div>
      
      <div className="flex-1 overflow-y-auto p-6 space-y-4 bg-slate-50">
        {messages.map((m, i) => (
          <div key={i} className={cn(
            "max-w-[85%] p-4 rounded-2xl text-sm leading-relaxed",
            m.role === 'user' 
              ? "bg-haiti-blue text-white ml-auto rounded-tr-none" 
              : "bg-white text-slate-800 shadow-sm border border-slate-100 rounded-tl-none"
          )}>
            <ReactMarkdown>{m.text}</ReactMarkdown>
          </div>
        ))}
        {loading && (
          <div className="bg-white text-slate-400 p-4 rounded-2xl rounded-tl-none shadow-sm border border-slate-100 w-fit animate-pulse">
            En train de réfléchir...
          </div>
        )}
      </div>

      <div className="p-4 bg-white border-t border-slate-100 flex gap-2">
        <input 
          type="text" 
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyPress={(e) => e.key === 'Enter' && handleSend()}
          placeholder="Posez votre question fiscale..."
          className="flex-1 bg-slate-100 border-none rounded-xl px-4 py-3 text-sm focus:ring-2 focus:ring-haiti-blue outline-none transition-all"
        />
        <button 
          onClick={handleSend}
          disabled={loading}
          className="bg-haiti-blue text-white p-3 rounded-xl hover:bg-blue-800 transition-all disabled:opacity-50"
        >
          <ChevronRight className="w-5 h-5" />
        </button>
      </div>
    </div>
  );
};

// --- Error Boundary ---
class ErrorBoundary extends React.Component<{ children: React.ReactNode }, { hasError: boolean, error: any }> {
  constructor(props: any) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: any) {
    return { hasError: true, error };
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-screen bg-slate-50 flex flex-col items-center justify-center p-8 text-center">
          <div className="bg-red-100 p-4 rounded-2xl mb-6">
            <AlertCircle className="w-12 h-12 text-red-600" />
          </div>
          <h2 className="text-2xl font-bold text-slate-900 mb-2">Oups ! Quelque chose s'est mal passé.</h2>
          <p className="text-slate-500 mb-6 max-w-md">
            Une erreur inattendue est survenue. Veuillez rafraîchir la page ou contacter le support si le problème persiste.
          </p>
          <pre className="bg-slate-900 text-slate-300 p-4 rounded-xl text-xs overflow-auto max-w-full text-left">
            {this.state.error?.message || 'Erreur inconnue'}
          </pre>
          <button 
            onClick={() => window.location.reload()}
            className="mt-8 px-6 py-3 bg-haiti-blue text-white rounded-xl font-bold hover:bg-blue-800 transition-all"
          >
            Rafraîchir la page
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}

const CalendarView = () => {
  const events = [
    { period: '1er juillet – 30 septembre', task: 'Déclaration valeur locative (CFPB)', target: 'Propriétaires d\'immeubles' },
    { period: '1er octobre – 31 mars', task: 'Paiement de la CFPB (sans surtaxe)', target: 'Propriétaires d\'immeubles' },
    { period: '1er octobre – 31 janvier', task: 'Paiement de la Patente', target: 'Commerçants, professions libérales' },
    { period: '15 octobre, 15 nov, 15 déc', task: 'Acomptes provisionnels IR', target: 'Professionnels/BNC' },
    { period: '1er octobre – 31 janvier', task: 'Dépôt Déclaration Définitive (DDIR)', target: 'Toutes personnes physiques' },
    { period: 'Mensuel', task: 'Versement des retenues à la source', target: 'Tous les employeurs' },
  ];

  return (
    <div className="space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-700">
      <header>
        <h1 className="text-3xl font-bold text-slate-900 tracking-tight">Calendrier Fiscal Haïtien</h1>
        <p className="text-slate-500 mt-2">Suivez vos échéances basées sur les régulations de la DGI.</p>
      </header>

      <div className="bg-white rounded-3xl border border-slate-200 shadow-xl overflow-hidden">
        <table className="w-full text-left border-collapse">
          <thead>
            <tr className="bg-slate-50 border-b border-slate-100">
              <th className="px-6 py-4 text-xs font-black text-slate-400 uppercase tracking-widest">Période</th>
              <th className="px-6 py-4 text-xs font-black text-slate-400 uppercase tracking-widest">Obligation Fiscale</th>
              <th className="px-6 py-4 text-xs font-black text-slate-400 uppercase tracking-widest">Clientèle Concernée</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {events.map((e, i) => (
              <tr key={i} className="hover:bg-slate-50 transition-colors">
                <td className="px-6 py-4 text-sm font-bold text-haiti-blue">{e.period}</td>
                <td className="px-6 py-4 text-sm text-slate-900 font-medium">{e.task}</td>
                <td className="px-6 py-4 text-sm text-slate-500 italic">{e.target}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
};

const QuitusView = ({ declarations }: { declarations: Declaration[] }) => {
  const isEligible = declarations.length > 0 && declarations.every(d => d.status === 'paid');
  const [requesting, setRequesting] = useState(false);

  return (
    <div className="space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-700">
      <header>
        <h1 className="text-3xl font-bold text-slate-900 tracking-tight">Quitus Fiscal Numérique</h1>
        <p className="text-slate-500 mt-2">Le document officiel attestant de votre conformité fiscale.</p>
      </header>

      <div className="bg-white rounded-3xl border border-slate-200 shadow-xl p-8 text-center max-w-2xl mx-auto">
        <div className={cn(
          "w-20 h-20 rounded-full flex items-center justify-center mx-auto mb-6",
          isEligible ? "bg-emerald-100 text-emerald-600" : "bg-red-100 text-haiti-red"
        )}>
          <ShieldCheck className="w-10 h-10" />
        </div>
        
        <h2 className="text-2xl font-bold text-slate-900 mb-2">
          {isEligible ? "Vous êtes en règle !" : "Action requise"}
        </h2>
        <p className="text-slate-500 mb-8 leading-relaxed">
          {isEligible 
            ? "Toutes vos déclarations ont été payées. Vous pouvez générer votre quitus fiscal instantanément."
            : "Pour obtenir votre quitus, vous devez d'abord vous acquitter de toutes vos dettes fiscales en attente."}
        </p>

        <button
          disabled={!isEligible || requesting}
          onClick={() => {
            setRequesting(true);
            setTimeout(() => setRequesting(false), 2000);
          }}
          className={cn(
            "w-full py-4 rounded-2xl font-bold transition-all shadow-lg",
            isEligible 
              ? "bg-haiti-blue text-white hover:bg-blue-800 shadow-blue-100" 
              : "bg-slate-100 text-slate-400 cursor-not-allowed"
          )}
        >
          {requesting ? "Génération du PDF..." : "Générer mon Quitus Fiscal"}
        </button>
      </div>
    </div>
  );
};

// --- Main App ---

export default function App() {
  return (
    <ErrorBoundary>
      <AppContent />
    </ErrorBoundary>
  );
}

function AppContent() {
  const [user, setUser] = useState<UserProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [isSigningIn, setIsSigningIn] = useState(false);
  const [authError, setAuthError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState('dashboard');
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  const [declarations, setDeclarations] = useState<Declaration[]>([]);
  const [isAddingDeclaration, setIsAddingDeclaration] = useState(false);
  const [isAddingFine, setIsAddingFine] = useState(false);
  const [declarationToPay, setDeclarationToPay] = useState<Declaration | null>(null);
  const [viewingDeclaration, setViewingDeclaration] = useState<Declaration | null>(null);
  const [payments, setPayments] = useState<Payment[]>([]);
  const [isProcessingPayment, setIsProcessingPayment] = useState(false);
  const [paymentResult, setPaymentResult] = useState<{status: 'success' | 'error', message: string} | null>(null);

  useEffect(() => {
    const testConnection = async () => {
      try {
        await getDocFromServer(doc(db, 'test', 'connection'));
      } catch (error) {
        if(error instanceof Error && error.message.includes('the client is offline')) {
          console.error("Firestore connectivity issue detected. The client is in offline mode.");
        }
      }
    };
    testConnection();

    const unsubscribe = onAuthStateChanged(auth, async (firebaseUser) => {
      if (firebaseUser) {
        try {
          const userDoc = await getDoc(doc(db, 'users', firebaseUser.uid));
          if (userDoc.exists()) {
            setUser(userDoc.data() as UserProfile);
          } else {
            // Create profile if first time
            const newProfile: UserProfile = {
              uid: firebaseUser.uid,
              displayName: firebaseUser.displayName || 'Utilisateur',
              email: firebaseUser.email || '',
              role: 'citizen',
              createdAt: new Date().toISOString()
            };
            await setDoc(doc(db, 'users', firebaseUser.uid), newProfile);
            setUser(newProfile);
          }
        } catch (error) {
          console.error("Auth profile error:", error);
        }
      } else {
        setUser(null);
      }
      setLoading(false);
    });

    return () => unsubscribe();
  }, []);

  useEffect(() => {
    if (!user) return;

    const q = query(
      collection(db, 'declarations'), 
      where('userId', '==', user.uid),
      orderBy('submissionDate', 'desc')
    );

    const unsubscribe = onSnapshot(q, (snapshot) => {
      const docs = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() })) as Declaration[];
      setDeclarations(docs);
    }, (error) => {
      handleFirestoreError(error, OperationType.GET, 'declarations');
    });

    return () => unsubscribe();
  }, [user]);

  useEffect(() => {
    if (!user) return;

    const q = query(
      collection(db, 'payments'), 
      where('userId', '==', user.uid),
      orderBy('paymentDate', 'desc')
    );

    const unsubscribe = onSnapshot(q, (snapshot) => {
      const docs = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() })) as Payment[];
      setPayments(docs);
    }, (error) => {
      handleFirestoreError(error, OperationType.GET, 'payments');
    });

    return () => unsubscribe();
  }, [user]);

  const handleSignIn = async () => {
    if (isSigningIn) return;
    setIsSigningIn(true);
    setAuthError(null);
    try {
      const provider = new GoogleAuthProvider();
      // Force select account to avoid some silent failures
      provider.setCustomParameters({ prompt: 'select_account' });
      await signInWithPopup(auth, provider);
    } catch (error: any) {
      console.error("Sign in error:", error);
      if (error.code === 'auth/popup-blocked') {
        setAuthError("Le popup a été bloqué par votre navigateur. Veuillez autoriser les popups pour ce site.");
      } else if (error.code === 'auth/cancelled-popup-request') {
        // Often happens if multiple clicks occur, we can just reset
      } else if (error.code === 'auth/popup-closed-by-user') {
        setAuthError("La fenêtre de connexion a été fermée avant la fin de l'authentification.");
      } else {
        setAuthError("Une erreur est survenue lors de la connexion. Veuillez réessayer.");
      }
    } finally {
      setIsSigningIn(false);
    }
  };

  const handleSignOut = async () => {
    try {
      await signOut(auth);
      setDeclarations([]);
      setPayments([]);
      setActiveTab('dashboard');
    } catch (error) {
      console.error("Sign out error:", error);
    }
  };

  const processPayment = async (method: Payment['method']) => {
    if (!declarationToPay || !user) return;
    setIsProcessingPayment(true);
    setPaymentResult(null);
    
    try {
      // Simulation d'un délai réseau/API
      await new Promise(resolve => setTimeout(resolve, 2500));

      const transactionRef = `E-FIS-${Math.random().toString(36).substring(7).toUpperCase()}`;
      
      const paymentData: Omit<Payment, 'id'> = {
        declarationId: declarationToPay.id,
        userId: user.uid,
        amount: declarationToPay.calculatedTax + (declarationToPay.penalties || 0),
        method,
        transactionRef,
        status: 'completed',
        paymentDate: new Date().toISOString()
      };
      
      await addDoc(collection(db, 'payments'), paymentData);
      
      await setDoc(doc(db, 'declarations', declarationToPay.id), {
        status: 'paid'
      }, { merge: true });
      
      setPaymentResult({
        status: 'success',
        message: `Paiement effectué avec succès via ${formatPaymentMethod(method)}.`
      });

      // On attend un peu avant de fermer
      setTimeout(() => {
        setDeclarationToPay(null);
        setPaymentResult(null);
        setActiveTab('payments');
      }, 3000);

    } catch (error) {
      console.error("Payment error:", error);
      setPaymentResult({
        status: 'error',
        message: "Une erreur est survenue lors de la transaction. Veuillez réessayer."
      });
      handleFirestoreError(error, OperationType.WRITE, 'payments');
    } finally {
      setIsProcessingPayment(false);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-slate-50 flex flex-col items-center justify-center p-8">
        <div className="bg-haiti-blue p-4 rounded-2xl animate-bounce shadow-xl shadow-blue-200">
          <ShieldCheck className="w-12 h-12 text-white" />
        </div>
        <p className="mt-6 text-slate-500 font-medium animate-pulse">Chargement de e-Fiscalité...</p>
      </div>
    );
  }

  if (!user) {
    return (
      <div className="min-h-screen bg-slate-50 flex flex-col md:flex-row">
        <div className="flex-1 p-8 md:p-24 flex flex-col justify-center">
          <div className="max-w-xl space-y-8">
            <div className="flex items-center gap-3">
              <div className="bg-white p-1 rounded-xl border border-slate-200 shadow-sm overflow-hidden flex items-center justify-center">
                <img src={DGI_LOGO_WEBP_BASE64} alt="DGI Logo" className="w-10 h-10 object-contain" />
              </div>
              <span className="font-black text-3xl text-slate-900 tracking-tighter">e-Fiscalité</span>
            </div>
            
            <div className="space-y-4">
              <h1 className="text-5xl md:text-7xl font-black text-slate-900 leading-[0.9] tracking-tighter">
                L'AVENIR FISCAL <br />
                <span className="text-haiti-red">D'HAÏTI</span> COMMENCE ICI.
              </h1>
              <p className="text-xl text-slate-500 leading-relaxed max-w-md">
                Déclarez vos impôts, payez vos taxes et obtenez vos attestations en ligne. Simple, transparent et sécurisé.
              </p>
            </div>

            {authError && (
              <motion.div 
                initial={{ opacity: 0, y: -10 }}
                animate={{ opacity: 1, y: 0 }}
                className="bg-red-50 border border-red-200 p-4 rounded-xl flex gap-3 text-red-700 text-sm"
              >
                <AlertCircle className="w-5 h-5 shrink-0" />
                <p>{authError}</p>
              </motion.div>
            )}

            <div className="flex flex-col sm:flex-row gap-4 pt-8">
              <button 
                onClick={handleSignIn}
                disabled={isSigningIn}
                className="px-8 py-4 bg-haiti-blue text-white rounded-2xl font-bold flex items-center justify-center gap-3 hover:bg-blue-800 transition-all shadow-xl shadow-blue-200 group disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {isSigningIn ? (
                  <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                ) : (
                  <img src="https://www.gstatic.com/firebasejs/ui/2.0.0/images/auth/google.svg" className="w-5 h-5" alt="Google" />
                )}
                {isSigningIn ? 'Connexion...' : 'Se connecter avec Google'}
                {!isSigningIn && <ChevronRight className="w-4 h-4 group-hover:translate-x-1 transition-transform" />}
              </button>
              <button className="px-8 py-4 bg-white border-2 border-haiti-red text-haiti-red rounded-2xl font-bold hover:bg-red-50 transition-all">
                En savoir plus
              </button>
            </div>

            <div className="pt-12 grid grid-cols-2 gap-8 border-t border-slate-200">
              <div>
                <p className="text-2xl font-bold text-slate-900">100%</p>
                <p className="text-xs text-slate-500 uppercase tracking-widest font-bold mt-1">Numérique</p>
              </div>
              <div>
                <p className="text-2xl font-bold text-slate-900">24/7</p>
                <p className="text-xs text-slate-500 uppercase tracking-widest font-bold mt-1">Disponibilité</p>
              </div>
            </div>
          </div>
        </div>
        
        <div className="hidden md:block flex-1 bg-haiti-blue relative overflow-hidden">
          <div className="absolute inset-0 bg-[radial-gradient(circle_at_50%_50%,rgba(255,255,255,0.1)_0%,transparent_100%)]" />
          <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[120%] aspect-square border border-white/10 rounded-full animate-spin-slow" />
          <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[80%] aspect-square border border-white/20 rounded-full animate-reverse-spin-slow" />
          
          <div className="absolute bottom-24 left-12 right-12 bg-white/10 backdrop-blur-xl border border-white/20 p-8 rounded-3xl">
            <p className="text-white text-2xl font-light italic leading-relaxed">
              "La numérisation de la fiscalité est un pilier majeur de la modernisation de l'État haïtien et de la lutte contre la corruption."
            </p>
            <div className="mt-6 flex items-center gap-4">
              <div className="w-12 h-12 bg-white rounded-full p-1.5 flex items-center justify-center shadow-md relative overflow-hidden">
                <img src={DGI_LOGO_WEBP_BASE64} alt="DGI Logo" className="w-full h-full object-contain" />
              </div>
              <div>
                <p className="text-white font-bold">Direction Générale des Impôts</p>
                <p className="text-white/60 text-xs uppercase tracking-widest">République d'Haïti</p>
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col">
      <Navbar 
        user={user} 
        onSignOut={handleSignOut} 
        toggleSidebar={() => setIsSidebarOpen(!isSidebarOpen)} 
      />
      
      <div className="flex flex-1">
        <Sidebar 
          activeTab={activeTab} 
          setActiveTab={setActiveTab} 
          isOpen={isSidebarOpen} 
          setIsOpen={setIsSidebarOpen} 
        />
        
        <main className="flex-1 p-4 md:p-8 max-w-6xl mx-auto w-full">
          <AnimatePresence mode="wait">
            {isAddingDeclaration ? (
              <motion.div
                key="form"
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -20 }}
              >
                <DeclarationForm 
                  mode="tax"
                  onCancel={() => setIsAddingDeclaration(false)} 
                  onSuccess={() => {
                    setIsAddingDeclaration(false);
                    setActiveTab('declarations');
                  }} 
                />
              </motion.div>
            ) : isAddingFine ? (
              <motion.div
                key="fine-form"
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -20 }}
              >
                <DeclarationForm 
                  mode="fine"
                  onCancel={() => setIsAddingFine(false)} 
                  onSuccess={() => {
                    setIsAddingFine(false);
                    setActiveTab('amendes');
                  }} 
                />
              </motion.div>
            ) : (
              <motion.div
                key={activeTab}
                initial={{ opacity: 0, x: 10 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -10 }}
                transition={{ duration: 0.2 }}
              >
                {activeTab === 'dashboard' && (
                  <DashboardHome user={user} declarations={declarations} />
                )}

                {activeTab === 'amendes' && (
                  <div className="space-y-6">
                    <div className="flex items-center justify-between">
                      <h2 className="text-2xl font-bold text-slate-900">Mes Amendes & Sanctions</h2>
                      <button 
                        onClick={() => setIsAddingFine(true)}
                        className="bg-amber-500 text-white px-4 py-2 rounded-xl font-bold flex items-center gap-2 hover:bg-amber-600 transition-all shadow-lg shadow-amber-100"
                      >
                        <Plus className="w-5 h-5" />
                        Payer une Amende
                      </button>
                    </div>
                    
                    <div className="grid grid-cols-1 gap-4">
                      {declarations.filter(d => ['amende_retard', 'amende_circulation', 'penalite_fiscale'].includes(d.taxType)).length > 0 ? (
                        declarations.filter(d => ['amende_retard', 'amende_circulation', 'penalite_fiscale'].includes(d.taxType)).map((d) => (
                          <div key={d.id} className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm flex flex-col md:flex-row md:items-center justify-between gap-4">
                            <div className="flex items-center gap-4">
                              <div className="bg-amber-50 p-3 rounded-xl text-amber-600">
                                <AlertCircle className="w-6 h-6" />
                              </div>
                              <div>
                                <h3 className="font-bold text-slate-900 uppercase">{formatTaxType(d.taxType)}</h3>
                                <p className="text-sm text-slate-500">Référence: {d.id.substring(0,8)} • Reçu le {new Date(d.submissionDate).toLocaleDateString()}</p>
                              </div>
                            </div>
                            <div className="flex items-center justify-between md:justify-end gap-8">
                              <div className="text-right">
                                <p className="text-xs text-slate-400 uppercase font-bold tracking-widest">Montant</p>
                                <p className="text-lg font-bold text-slate-900">{d.calculatedTax.toLocaleString()} HTG</p>
                              </div>
                              <div className="flex flex-col items-end">
                                <span className={cn(
                                  "px-3 py-1 rounded-full text-xs font-bold uppercase tracking-wider",
                                  d.status === 'paid' ? "bg-emerald-100 text-emerald-700" :
                                  d.status === 'pending' ? "bg-amber-100 text-amber-700" :
                                  "bg-slate-100 text-slate-700"
                                )}>
                                  {d.status === 'paid' ? 'Acquittée' : d.status === 'pending' ? 'À payer' : d.status}
                                </span>
                                <div className="flex gap-3 mt-2">
                                  {d.status === 'paid' && (
                                    <button 
                                      onClick={() => generateDeclarationPDF(d, user)}
                                      className="text-xs text-emerald-600 font-bold hover:underline flex items-center gap-1"
                                    >
                                      <Download className="w-3 h-3" />
                                      Télécharger PDF
                                    </button>
                                  )}
                                  {d.status === 'pending' && (
                                    <button 
                                      onClick={() => setDeclarationToPay(d)}
                                      className="text-xs text-haiti-blue font-bold hover:underline"
                                    >
                                      Procéder au paiement
                                    </button>
                                  )}
                                </div>
                              </div>
                            </div>
                          </div>
                        ))
                      ) : (
                        <div className="bg-white p-12 rounded-2xl border border-dashed border-slate-300 text-center">
                          <p className="text-slate-400">Aucune amende enregistrée dans votre dossier.</p>
                        </div>
                      )}
                    </div>
                  </div>
                )}
                
                {activeTab === 'quitus' && (
                  <QuitusView declarations={declarations} />
                )}

                {activeTab === 'calendar' && (
                  <CalendarView />
                )}
                
                {activeTab === 'declarations' && (
                  <div className="space-y-6">
                    <div className="flex items-center justify-between">
                      <h2 className="text-2xl font-bold text-slate-900">Mes Déclarations</h2>
                      <button 
                        onClick={() => setIsAddingDeclaration(true)}
                        className="bg-haiti-red text-white px-4 py-2 rounded-xl font-bold flex items-center gap-2 hover:bg-red-700 transition-all shadow-lg shadow-red-100"
                      >
                        <Plus className="w-5 h-5" />
                        Nouvelle Déclaration
                      </button>
                    </div>
                    
                    <div className="grid grid-cols-1 gap-4">
                      {declarations.filter(d => !['amende_retard', 'amende_circulation', 'penalite_fiscale'].includes(d.taxType)).length > 0 ? (
                        declarations.filter(d => !['amende_retard', 'amende_circulation', 'penalite_fiscale'].includes(d.taxType)).map((d) => (
                          <div key={d.id} className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm flex flex-col md:flex-row md:items-center justify-between gap-4">
                            <div className="flex items-center gap-4">
                              <div className="bg-slate-100 p-3 rounded-xl">
                                <FileText className="w-6 h-6 text-slate-600" />
                              </div>
                              <div>
                                <h3 className="font-bold text-slate-900 uppercase">{formatTaxType(d.taxType)}</h3>
                                <p className="text-sm text-slate-500">Période: {d.period} • Soumis le {new Date(d.submissionDate).toLocaleDateString()}</p>
                              </div>
                            </div>
                            <div className="flex items-center justify-between md:justify-end gap-8">
                              <div className="text-right">
                                <p className="text-xs text-slate-400 uppercase font-bold tracking-widest">Montant</p>
                                <p className="text-lg font-bold text-slate-900">{d.calculatedTax.toLocaleString()} HTG</p>
                              </div>
                              <div className="flex flex-col items-end">
                                <span className={cn(
                                  "px-3 py-1 rounded-full text-xs font-bold uppercase tracking-wider",
                                  d.status === 'paid' ? "bg-blue-100 text-haiti-blue" :
                                  d.status === 'pending' ? "bg-amber-100 text-amber-700" :
                                  "bg-slate-100 text-slate-700"
                                )}>
                                  {d.status}
                                </span>
                                <div className="flex gap-3 mt-2">
                                  {d.status === 'paid' && (
                                    <button 
                                      onClick={() => generateDeclarationPDF(d, user)}
                                      className="text-xs text-emerald-600 font-bold hover:underline flex items-center gap-1"
                                    >
                                      <Download className="w-3 h-3" />
                                      Télécharger PDF
                                    </button>
                                  )}
                                  <button 
                                    onClick={() => setViewingDeclaration(d)}
                                    className="text-xs text-slate-500 font-bold hover:underline"
                                  >
                                    Détails
                                  </button>
                                  {d.status === 'pending' && (
                                    <button 
                                      onClick={() => setDeclarationToPay(d)}
                                      className="text-xs text-haiti-blue font-bold hover:underline"
                                    >
                                      Payer
                                    </button>
                                  )}
                                </div>
                              </div>
                            </div>
                          </div>
                        ))
                      ) : (
                        <div className="bg-white p-12 rounded-2xl border border-dashed border-slate-300 text-center">
                          <p className="text-slate-400">Vous n'avez pas encore de déclaration.</p>
                        </div>
                      )}
                    </div>
                  </div>
                )}

                {activeTab === 'payments' && (
                  <div className="space-y-6">
                    <h2 className="text-2xl font-bold text-slate-900">Historique des Paiements</h2>
                    <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
                      <table className="w-full text-left border-collapse">
                        <thead className="bg-slate-50 text-slate-500 text-xs uppercase font-bold tracking-widest">
                          <tr>
                            <th className="px-6 py-4">Référence</th>
                            <th className="px-6 py-4">Date</th>
                            <th className="px-6 py-4">Méthode</th>
                            <th className="px-6 py-4">Montant</th>
                            <th className="px-6 py-4">Statut</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100">
                          {payments.length > 0 ? payments.map((p) => (
                            <tr key={p.id} className="hover:bg-slate-50 transition-colors">
                              <td className="px-6 py-4 text-sm font-mono">{p.transactionRef}</td>
                              <td className="px-6 py-4 text-sm">{new Date(p.paymentDate).toLocaleDateString()}</td>
                              <td className="px-6 py-4 text-sm uppercase">{formatPaymentMethod(p.method)}</td>
                              <td className="px-6 py-4 text-sm font-bold">{p.amount.toLocaleString()} HTG</td>
                              <td className="px-6 py-4">
                                <span className={cn(
                                  "px-2 py-0.5 rounded-full text-[10px] font-bold uppercase",
                                  p.status === 'completed' ? "bg-emerald-100 text-emerald-700" : "bg-amber-100 text-amber-700"
                                )}>
                                  {p.status}
                                </span>
                              </td>
                            </tr>
                          )) : (
                            <tr>
                              <td colSpan={5} className="p-12 text-center text-slate-400 text-sm italic">
                                Aucun paiement enregistré.
                              </td>
                            </tr>
                          )}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}

                {activeTab === 'assistant' && (
                  <div className="space-y-6">
                    <h2 className="text-2xl font-bold text-slate-900">Assistant Fiscal Intelligent</h2>
                    <Chatbot />
                  </div>
                )}

                {activeTab === 'profile' && (
                  <div className="max-w-2xl mx-auto space-y-8">
                    <div className="bg-white p-8 rounded-2xl border border-slate-200 shadow-sm">
                      <div className="flex items-center gap-6 mb-8">
                        <div className="w-20 h-20 bg-blue-100 rounded-full flex items-center justify-center text-haiti-blue">
                          <UserIcon className="w-10 h-10" />
                        </div>
                        <div>
                          <h2 className="text-2xl font-bold text-slate-900">{user.displayName}</h2>
                          <p className="text-slate-500">{user.email}</p>
                        </div>
                      </div>
                      
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                        <div className="space-y-1">
                          <p className="text-xs font-bold text-slate-400 uppercase tracking-widest">Rôle</p>
                          <p className="text-sm font-medium text-slate-900 uppercase">{user.role}</p>
                        </div>
                        <div className="space-y-1">
                          <p className="text-xs font-bold text-slate-400 uppercase tracking-widest">NIF / Matricule</p>
                          <p className="text-sm font-medium text-slate-900">{user.taxId || 'Non renseigné'}</p>
                        </div>
                        <div className="space-y-1">
                          <p className="text-xs font-bold text-slate-400 uppercase tracking-widest">Téléphone</p>
                          <p className="text-sm font-medium text-slate-900">{user.phoneNumber || 'Non renseigné'}</p>
                        </div>
                        <div className="space-y-1">
                          <p className="text-xs font-bold text-slate-400 uppercase tracking-widest">Date d'inscription</p>
                          <p className="text-sm font-medium text-slate-900">{new Date(user.createdAt).toLocaleDateString()}</p>
                        </div>
                      </div>
                      
                      <button className="mt-8 w-full py-3 border border-slate-200 rounded-xl font-bold text-slate-600 hover:bg-slate-50 transition-all">
                        Modifier mes informations
                      </button>
                    </div>
                    
                    <div className="bg-amber-50 border border-amber-200 p-6 rounded-2xl flex gap-4">
                      <AlertCircle className="w-6 h-6 text-amber-600 shrink-0" />
                      <div>
                        <p className="text-sm font-bold text-amber-900">Sécurité du compte</p>
                        <p className="text-xs text-amber-700 mt-1">
                          Assurez-vous que votre NIF est correctement renseigné pour éviter tout retard dans le traitement de vos déclarations.
                        </p>
                      </div>
                    </div>
                  </div>
                )}
              </motion.div>
            )}
          </AnimatePresence>
        </main>
      </div>

      <AnimatePresence>
        {declarationToPay && (
          <div className="fixed inset-0 z-[60] flex items-center justify-center p-4">
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => !isProcessingPayment && setDeclarationToPay(null)}
              className="absolute inset-0 bg-slate-900/60 backdrop-blur-sm"
            />
            <motion.div 
              initial={{ opacity: 0, scale: 0.95, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 20 }}
              className="bg-white w-full max-w-md rounded-3xl shadow-2xl relative z-10 overflow-hidden"
            >
              <div className="bg-haiti-blue p-6 text-white text-center">
                <div className="w-16 h-16 bg-white/20 rounded-full flex items-center justify-center mx-auto mb-4">
                  <CreditCard className="w-8 h-8" />
                </div>
                <h3 className="text-xl font-bold">Règlement des Impôts</h3>
                <p className="text-white/60 text-sm mt-1 uppercase tracking-widest font-bold">
                  {formatTaxType(declarationToPay.taxType)} / {declarationToPay.period}
                </p>
              </div>
              
              {!paymentResult ? (
                <div className="p-8 space-y-6">
                  <div className="flex justify-between items-end pb-6 border-b border-slate-100">
                    <span className="text-slate-500 font-medium">Montant total dû</span>
                    <span className="text-3xl font-black text-slate-900">
                      {(declarationToPay.calculatedTax + (declarationToPay.penalties || 0)).toLocaleString()} HTG
                    </span>
                  </div>
                  
                  <div className="space-y-3">
                    <p className="text-xs font-bold text-slate-400 uppercase tracking-widest mb-4">Choisir une méthode de paiement</p>
                    
                    <button 
                      onClick={() => processPayment('moncash')}
                      disabled={isProcessingPayment}
                      className="w-full p-4 border border-slate-200 rounded-2xl flex items-center justify-between hover:bg-slate-50 transition-all group"
                    >
                      <div className="flex items-center gap-4">
                        <div className="w-10 h-10 bg-red-600 rounded-xl flex items-center justify-center text-white font-black group-hover:rotate-12 transition-transform">MC</div>
                        <div className="text-left">
                          <p className="font-bold text-slate-900">MonCash</p>
                          <p className="text-xs text-slate-500">Paiement mobile sécurisé</p>
                        </div>
                      </div>
                      <ChevronRight className="w-5 h-5 text-slate-300" />
                    </button>

                    <button 
                      onClick={() => processPayment('natcash')}
                      disabled={isProcessingPayment}
                      className="w-full p-4 border border-slate-200 rounded-2xl flex items-center justify-between hover:bg-slate-50 transition-all group"
                    >
                      <div className="flex items-center gap-4">
                        <div className="w-10 h-10 bg-amber-500 rounded-xl flex items-center justify-center text-white font-black group-hover:rotate-12 transition-transform">NC</div>
                        <div className="text-left">
                          <p className="font-bold text-slate-900">Natcash</p>
                          <p className="text-xs text-slate-500">Paiement mobile instantané</p>
                        </div>
                      </div>
                      <ChevronRight className="w-5 h-5 text-slate-300" />
                    </button>

                    <button 
                      onClick={() => processPayment('credit_card')}
                      disabled={isProcessingPayment}
                      className="w-full p-4 border border-slate-200 rounded-2xl flex items-center justify-between hover:bg-slate-50 transition-all group"
                    >
                      <div className="flex items-center gap-4">
                        <div className="w-10 h-10 bg-blue-600 rounded-xl flex items-center justify-center text-white font-black group-hover:rotate-12 transition-transform">CC</div>
                        <div className="text-left">
                          <p className="font-bold text-slate-900">Carte de Crédit</p>
                          <p className="text-xs text-slate-500">Visa, Mastercard, AMEX</p>
                        </div>
                      </div>
                      <ChevronRight className="w-5 h-5 text-slate-300" />
                    </button>

                    <button 
                      onClick={() => processPayment('debit_card')}
                      disabled={isProcessingPayment}
                      className="w-full p-4 border border-slate-200 rounded-2xl flex items-center justify-between hover:bg-slate-50 transition-all group"
                    >
                      <div className="flex items-center gap-4">
                        <div className="w-10 h-10 bg-emerald-600 rounded-xl flex items-center justify-center text-white font-black group-hover:rotate-12 transition-transform">DC</div>
                        <div className="text-left">
                          <p className="font-bold text-slate-900">Carte de Débit</p>
                          <p className="text-xs text-slate-500">Carte locale ou internationale</p>
                        </div>
                      </div>
                      <ChevronRight className="w-5 h-5 text-slate-300" />
                    </button>

                    <button 
                      onClick={() => processPayment('paypal')}
                      disabled={isProcessingPayment}
                      className="w-full p-4 border border-slate-200 rounded-2xl flex items-center justify-between hover:bg-slate-50 transition-all group"
                    >
                      <div className="flex items-center gap-4">
                        <div className="w-10 h-10 bg-sky-500 rounded-xl flex items-center justify-center text-white font-black group-hover:rotate-12 transition-transform">PP</div>
                        <div className="text-left">
                          <p className="font-bold text-slate-900">PayPal</p>
                          <p className="text-xs text-slate-500">Sécurité PayPal Monde</p>
                        </div>
                      </div>
                      <ChevronRight className="w-5 h-5 text-slate-300" />
                    </button>
                    
                    <button 
                      disabled
                      className="w-full p-4 border border-slate-100 bg-slate-50 rounded-2xl flex items-center justify-between opacity-50 cursor-not-allowed"
                    >
                      <div className="flex items-center gap-4">
                        <div className="w-10 h-10 bg-slate-200 rounded-xl flex items-center justify-center text-slate-400 font-bold">BT</div>
                        <div className="text-left">
                          <p className="font-bold text-slate-400">Virement Bancaire (BRH)</p>
                          <p className="text-xs text-slate-400">Disponible prochainement</p>
                        </div>
                      </div>
                      <X className="w-5 h-5 text-slate-300" />
                    </button>
                  </div>

                  <button 
                    onClick={() => setDeclarationToPay(null)}
                    disabled={isProcessingPayment}
                    className="w-full text-slate-500 text-sm font-bold hover:text-slate-700 transition-colors py-2"
                  >
                    Annuler l'opération
                  </button>
                </div>
              ) : (
                <div className="p-12 flex flex-col items-center text-center animate-in zoom-in-95 duration-500">
                  <div className={cn(
                    "w-20 h-20 rounded-full flex items-center justify-center mb-6",
                    paymentResult.status === 'success' ? "bg-emerald-100 text-emerald-600" : "bg-red-100 text-red-600"
                  )}>
                    {paymentResult.status === 'success' ? <ShieldCheck className="w-12 h-12" /> : <X className="w-12 h-12" />}
                  </div>
                  <h4 className="text-2xl font-bold text-slate-900 mb-2">
                    {paymentResult.status === 'success' ? "Paiement Confirmé" : "Échec du Paiement"}
                  </h4>
                  <p className="text-slate-500">{paymentResult.message}</p>
                  
                  {paymentResult.status === 'success' && (
                    <div className="mt-8 p-4 bg-slate-50 rounded-2xl w-full text-left">
                      <p className="text-xs text-slate-400 uppercase font-bold tracking-widest mb-2">Référence Transaction</p>
                      <p className="font-mono text-sm text-slate-700 select-all">E-FIS-TXN-{Math.random().toString(36).substring(7).toUpperCase()}</p>
                    </div>
                  )}

                  <button 
                    onClick={() => {
                      setDeclarationToPay(null);
                      setPaymentResult(null);
                      setActiveTab('payments');
                    }}
                    className="mt-8 text-haiti-blue font-bold hover:underline"
                  >
                    Fermer et voir les reçus
                  </button>
                </div>
              )}
              
              {isProcessingPayment && (
                <div className="absolute inset-0 bg-white/80 backdrop-blur-sm z-20 flex flex-col items-center justify-center">
                  <div className="w-8 h-8 border-4 border-haiti-blue/30 border-t-haiti-blue rounded-full animate-spin mb-4" />
                  <p className="font-bold text-slate-900">Traitement sécurisé...</p>
                  <p className="text-xs text-slate-500 mt-1 uppercase tracking-widest">Ne quittez pas cette page</p>
                </div>
              )}
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {viewingDeclaration && (
          <div className="fixed inset-0 z-[60] flex items-center justify-center p-4">
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setViewingDeclaration(null)}
              className="absolute inset-0 bg-slate-900/60 backdrop-blur-sm"
            />
            <motion.div 
              initial={{ opacity: 0, scale: 0.95, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 20 }}
              className="bg-white w-full max-w-lg rounded-3xl shadow-2xl relative z-10 overflow-hidden"
            >
              <div className="bg-slate-50 p-6 border-b border-slate-100 flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="bg-haiti-red p-2 rounded-lg text-white">
                    <FileText className="w-5 h-5" />
                  </div>
                  <div>
                    <h3 className="font-bold text-slate-900 uppercase">{formatTaxType(viewingDeclaration.taxType)}</h3>
                    <p className="text-xs text-slate-500">Réf: {viewingDeclaration.id?.substring(0, 8)}</p>
                  </div>
                </div>
                <button onClick={() => setViewingDeclaration(null)} className="p-2 hover:bg-slate-200 rounded-full transition-colors">
                  <X className="w-5 h-5 text-slate-400" />
                </button>
              </div>
              
              <div className="p-8 space-y-6">
                <div className="grid grid-cols-2 gap-8">
                  <div>
                    <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1">Période</p>
                    <p className="font-bold text-slate-900">{viewingDeclaration.period}</p>
                  </div>
                  <div>
                    <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1">Statut</p>
                    <span className={cn(
                      "inline-block px-2 py-0.5 rounded-full text-[10px] font-bold uppercase",
                      viewingDeclaration.status === 'paid' ? "bg-emerald-100 text-emerald-700" : "bg-amber-100 text-amber-700"
                    )}>
                      {viewingDeclaration.status}
                    </span>
                  </div>
                </div>

                <div className="p-4 bg-slate-50 rounded-2xl border border-slate-100 space-y-3">
                  <div className="flex justify-between items-center text-sm">
                    <span className="text-slate-500">Base Imposable</span>
                    <span className="font-bold text-slate-900">{viewingDeclaration.amountDeclared.toLocaleString()} HTG</span>
                  </div>
                  {viewingDeclaration.deductions > 0 && (
                    <div className="flex justify-between items-center text-sm text-emerald-600">
                      <span>Déductions</span>
                      <span>- {viewingDeclaration.deductions.toLocaleString()} HTG</span>
                    </div>
                  )}
                  {viewingDeclaration.calcDetails.masseSalariale > 0 && (
                    <div className="flex justify-between items-center text-sm">
                      <span className="text-slate-500">Masse Salariale</span>
                      <span className="font-bold text-slate-900">{viewingDeclaration.calcDetails.masseSalariale.toLocaleString()} HTG</span>
                    </div>
                  )}
                  <div className="pt-3 border-t border-slate-200 flex justify-between items-center">
                    <span className="font-bold text-slate-900">Impôt Principal</span>
                    <span className="text-xl font-black text-haiti-blue">{viewingDeclaration.calculatedTax.toLocaleString()} HTG</span>
                  </div>
                  {viewingDeclaration.penalties > 0 && (
                    <div className="flex justify-between items-center text-sm text-haiti-red">
                      <span>Pénalités de retard</span>
                      <span>+ {viewingDeclaration.penalties.toLocaleString()} HTG</span>
                    </div>
                  )}
                </div>

                {viewingDeclaration.taxType === 'taxe_locative' && (
                  <div className="text-xs text-slate-400 space-y-1 bg-amber-50 p-3 rounded-xl border border-amber-100">
                    <p>● Meublé: {viewingDeclaration.calcDetails.isFurnished ? 'Oui (Réduction appliquée)' : 'Non'}</p>
                    {viewingDeclaration.calcDetails.newBuildYear > 0 && (
                      <p>● Année construction: {viewingDeclaration.calcDetails.newBuildYear} (Exonération partielle)</p>
                    )}
                  </div>
                )}

                {viewingDeclaration.notes && (
                  <div>
                    <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1">Notes</p>
                    <p className="text-sm text-slate-600 italic px-4 py-3 bg-slate-50 rounded-xl border border-slate-100">
                      "{viewingDeclaration.notes}"
                    </p>
                  </div>
                )}

                <div className="flex gap-4 pt-4">
                  {viewingDeclaration.status === 'pending' && (
                    <button 
                      onClick={() => {
                        setDeclarationToPay(viewingDeclaration);
                        setViewingDeclaration(null);
                      }}
                      className="flex-1 bg-haiti-blue text-white py-4 rounded-2xl font-bold hover:bg-blue-800 shadow-xl shadow-blue-100 transition-all"
                    >
                      Payer maintenant
                    </button>
                  )}
                  <button 
                    onClick={() => setViewingDeclaration(null)}
                    className={cn(
                      "py-4 rounded-2xl font-bold transition-all",
                      viewingDeclaration.status === 'paid' ? "flex-1 bg-slate-900 text-white" : "px-8 bg-slate-100 text-slate-600"
                    )}
                  >
                    Fermer
                  </button>
                </div>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
      
      <footer className="bg-white border-t border-slate-200 py-6 px-8 text-center">
        <p className="text-xs text-slate-400 font-medium tracking-wide">
          © 2026 RÉPUBLIQUE D'HAÏTI • MINISTÈRE DE L'ÉCONOMIE ET DES FINANCES • DIRECTION GÉNÉRALE DES IMPÔTS
        </p>
      </footer>
    </div>
  );
}
