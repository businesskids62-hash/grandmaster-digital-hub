import { useState } from 'react';
import { Receipt, Plus, Trash2, Printer, RotateCcw, Building, UserCheck } from 'lucide-react';
import { useLanguage } from '../hooks/useLanguage';

export default function InvoiceMaker() {
  const { isRtl } = useLanguage();

  const [invoice, setInvoice] = useState({
    invoiceNumber: 'INV-2026-001',
    issueDate: new Date().toISOString().split('T')[0],
    dueDate: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
    currency: 'PKR',
    senderName: 'Grandmaster Digital Agency',
    senderEmail: 'billing@grandmasterhub.local',
    senderAddress: 'Suite 401, Tech Innovation Tower, Lahore, Pakistan',
    clientName: 'Alpha Global Ventures',
    clientEmail: 'finance@alphaglobal.com',
    clientAddress: 'Plot 12-B, Commercial District, Karachi',
    items: [
      { id: '1', description: 'Web Application Development - Phase 1 Foundation', qty: 1, rate: 85000 },
      { id: '2', description: 'UI/UX Design Systems & High-Fidelity Mockups', qty: 1, rate: 35000 },
      { id: '3', description: 'Cloud Infrastructure & Client Architecture Setup', qty: 1, rate: 20000 }
    ],
    taxRate: 5,
    discountRate: 0,
    notes: 'Payment is due within 14 days of issue date. Thank you for your business!'
  });

  const updateItem = (index, field, value) => {
    const updated = [...invoice.items];
    updated[index][field] = field === 'description' ? value : Number(value);
    setInvoice(prev => ({ ...prev, items: updated }));
  };

  const addItem = () => {
    setInvoice(prev => ({
      ...prev,
      items: [
        ...prev.items,
        { id: Date.now().toString(), description: 'New Service Item', qty: 1, rate: 5000 }
      ]
    }));
  };

  const removeItem = (index) => {
    if (invoice.items.length <= 1) return;
    setInvoice(prev => ({
      ...prev,
      items: prev.items.filter((_, i) => i !== index)
    }));
  };

  const subtotal = invoice.items.reduce((sum, item) => sum + (item.qty * item.rate), 0);
  const taxAmount = (subtotal * invoice.taxRate) / 100;
  const discountAmount = (subtotal * invoice.discountRate) / 100;
  const total = subtotal + taxAmount - discountAmount;

  const handlePrint = () => {
    window.print();
  };

  const currencySymbol = invoice.currency === 'PKR' ? '₨' : invoice.currency === 'USD' ? '$' : '€';

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      {/* Action Header (hidden on print) */}
      <div className="p-4 sm:p-6 bg-white dark:bg-brand-navy-800 rounded-3xl shadow-xl border border-slate-200 dark:border-brand-navy-700 flex flex-wrap items-center justify-between gap-4 no-print">
        <div className="flex items-center gap-3">
          <div className="p-2.5 bg-brand-gold-500/10 text-brand-gold-500 rounded-2xl">
            <Receipt className="w-6 h-6" />
          </div>
          <div>
            <h3 className="font-bold text-lg text-slate-900 dark:text-white">
              {isRtl ? 'پیشہ ورانہ انوائس میکر' : 'Professional Invoice Maker'}
            </h3>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              {isRtl ? 'آئٹمائزڈ بل تیار کریں اور براہ راست پرنٹ یا پی ڈی ایف کے طور پر محفوظ کریں' : 'Custom billing with tax, discounts, and high-fidelity print output'}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={handlePrint}
            className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl font-bold text-xs uppercase tracking-wider bg-gradient-to-r from-brand-gold-500 to-amber-500 hover:from-brand-gold-400 hover:to-amber-400 text-brand-navy-900 shadow-md transition"
          >
            <Printer className="w-4 h-4" />
            <span>{isRtl ? 'پرنٹ / پی ڈی ایف محفوظ کریں' : 'Print / Save PDF'}</span>
          </button>
        </div>
      </div>

      {/* Printable Invoice Sheet */}
      <div className="bg-white text-slate-900 p-8 sm:p-12 rounded-3xl shadow-xl border border-slate-200 dark:border-brand-navy-700 print:shadow-none print:border-none print:p-0 print:m-0">
        {/* Invoice Top Header */}
        <div className="flex flex-col sm:flex-row justify-between items-start gap-6 border-b border-slate-200 pb-8">
          <div>
            <span className="text-2xl sm:text-3xl font-extrabold tracking-tight text-brand-navy-900 flex items-center gap-2">
              <span>{invoice.senderName}</span>
            </span>
            <div className="mt-2 text-xs text-slate-500 space-y-1">
              <p>{invoice.senderEmail}</p>
              <p>{invoice.senderAddress}</p>
            </div>
          </div>

          <div className="text-left sm:text-right space-y-2">
            <h2 className="text-3xl font-black tracking-wider text-brand-gold-600 uppercase">
              INVOICE
            </h2>
            <div className="text-xs text-slate-600 space-y-1">
              <p>
                <strong>Invoice #:</strong>{' '}
                <span className="font-mono">{invoice.invoiceNumber}</span>
              </p>
              <p>
                <strong>Issue Date:</strong> {invoice.issueDate}
              </p>
              <p>
                <strong>Due Date:</strong> {invoice.dueDate}
              </p>
            </div>
          </div>
        </div>

        {/* Bill To & Details Fields */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-8 my-8">
          <div className="p-4 rounded-xl bg-slate-50 border border-slate-100">
            <h4 className="text-xs font-bold uppercase tracking-wider text-slate-400 mb-2 flex items-center gap-1.5">
              <UserCheck className="w-4 h-4 text-brand-gold-500" />
              <span>Billed To:</span>
            </h4>
            <div className="space-y-1.5 text-xs">
              <input
                type="text"
                value={invoice.clientName}
                onChange={(e) => setInvoice({ ...invoice, clientName: e.target.value })}
                className="w-full font-bold text-sm bg-transparent border-b border-transparent hover:border-slate-300 focus:border-brand-gold-500 focus:outline-none"
              />
              <input
                type="text"
                value={invoice.clientEmail}
                onChange={(e) => setInvoice({ ...invoice, clientEmail: e.target.value })}
                className="w-full text-slate-600 bg-transparent border-b border-transparent hover:border-slate-300 focus:border-brand-gold-500 focus:outline-none"
              />
              <input
                type="text"
                value={invoice.clientAddress}
                onChange={(e) => setInvoice({ ...invoice, clientAddress: e.target.value })}
                className="w-full text-slate-500 bg-transparent border-b border-transparent hover:border-slate-300 focus:border-brand-gold-500 focus:outline-none"
              />
            </div>
          </div>

          <div className="p-4 rounded-xl bg-slate-50 border border-slate-100 flex flex-col justify-between">
            <div>
              <h4 className="text-xs font-bold uppercase tracking-wider text-slate-400 mb-2">
                Currency & Settings:
              </h4>
              <div className="flex gap-4 text-xs no-print">
                <label className="flex items-center gap-1.5">
                  <span className="text-slate-500">Currency:</span>
                  <select
                    value={invoice.currency}
                    onChange={(e) => setInvoice({ ...invoice, currency: e.target.value })}
                    className="font-bold border border-slate-300 rounded px-2 py-1 bg-white"
                  >
                    <option value="PKR">PKR (₨)</option>
                    <option value="USD">USD ($)</option>
                    <option value="EUR">EUR (€)</option>
                  </select>
                </label>
              </div>
            </div>
            <div className="text-xs text-slate-500 mt-2">
              Payment Terms: Net 14 Days
            </div>
          </div>
        </div>

        {/* Itemized Table */}
        <div className="overflow-x-auto mb-8">
          <table className="w-full text-left text-xs border-collapse">
            <thead>
              <tr className="border-b-2 border-slate-900 bg-slate-100 text-slate-800">
                <th className="py-3 px-3 uppercase tracking-wider font-bold">Item Description</th>
                <th className="py-3 px-3 uppercase tracking-wider font-bold text-center w-20">Qty</th>
                <th className="py-3 px-3 uppercase tracking-wider font-bold text-right w-32">Unit Price</th>
                <th className="py-3 px-3 uppercase tracking-wider font-bold text-right w-32">Total</th>
                <th className="py-3 px-2 w-10 no-print"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {invoice.items.map((item, idx) => (
                <tr key={item.id} className="hover:bg-slate-50/50">
                  <td className="py-3 px-3">
                    <input
                      type="text"
                      value={item.description}
                      onChange={(e) => updateItem(idx, 'description', e.target.value)}
                      className="w-full bg-transparent font-medium text-slate-800 focus:outline-none focus:ring-1 focus:ring-brand-gold-500 rounded px-1"
                    />
                  </td>
                  <td className="py-3 px-3 text-center">
                    <input
                      type="number"
                      min="1"
                      value={item.qty}
                      onChange={(e) => updateItem(idx, 'qty', e.target.value)}
                      className="w-16 text-center bg-transparent font-mono focus:outline-none focus:ring-1 focus:ring-brand-gold-500 rounded px-1"
                    />
                  </td>
                  <td className="py-3 px-3 text-right">
                    <input
                      type="number"
                      min="0"
                      value={item.rate}
                      onChange={(e) => updateItem(idx, 'rate', e.target.value)}
                      className="w-24 text-right bg-transparent font-mono focus:outline-none focus:ring-1 focus:ring-brand-gold-500 rounded px-1"
                    />
                  </td>
                  <td className="py-3 px-3 text-right font-mono font-bold text-slate-800">
                    {currencySymbol} {(item.qty * item.rate).toLocaleString()}
                  </td>
                  <td className="py-3 px-2 text-center no-print">
                    <button
                      type="button"
                      onClick={() => removeItem(idx)}
                      disabled={invoice.items.length <= 1}
                      className="text-slate-400 hover:text-red-500 disabled:opacity-20 transition"
                      title="Remove item"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Add Item Button (no-print) */}
        <div className="mb-6 no-print">
          <button
            type="button"
            onClick={addItem}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-dashed border-slate-300 text-xs font-semibold text-slate-600 hover:text-brand-gold-600 hover:border-brand-gold-500 transition"
          >
            <Plus className="w-3.5 h-3.5" />
            <span>Add Line Item</span>
          </button>
        </div>

        {/* Calculation Summary */}
        <div className="flex flex-col sm:flex-row justify-between items-start gap-8 pt-4 border-t border-slate-200">
          <div className="w-full sm:w-1/2 space-y-2">
            <h4 className="text-xs font-bold uppercase tracking-wider text-slate-500">Notes & Payment Instructions:</h4>
            <textarea
              rows={3}
              value={invoice.notes}
              onChange={(e) => setInvoice({ ...invoice, notes: e.target.value })}
              className="w-full text-xs text-slate-600 bg-slate-50 p-2.5 rounded-xl border border-slate-200 focus:outline-none focus:ring-1 focus:ring-brand-gold-500"
            />
          </div>

          <div className="w-full sm:w-1/2 max-w-xs ml-auto space-y-2 text-xs">
            <div className="flex justify-between py-1 text-slate-600">
              <span>Subtotal:</span>
              <span className="font-mono font-semibold">{currencySymbol} {subtotal.toLocaleString()}</span>
            </div>
            <div className="flex justify-between items-center py-1 text-slate-600">
              <span className="flex items-center gap-1">
                Tax ({invoice.taxRate}%):
              </span>
              <span className="font-mono font-semibold">{currencySymbol} {taxAmount.toLocaleString()}</span>
            </div>
            {invoice.discountRate > 0 && (
              <div className="flex justify-between items-center py-1 text-emerald-600">
                <span>Discount ({invoice.discountRate}%):</span>
                <span className="font-mono font-semibold">- {currencySymbol} {discountAmount.toLocaleString()}</span>
              </div>
            )}
            <div className="flex justify-between py-3 border-t-2 border-slate-900 text-base font-extrabold text-slate-900">
              <span>Total Due:</span>
              <span className="font-mono text-brand-gold-600">{currencySymbol} {total.toLocaleString()}</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
