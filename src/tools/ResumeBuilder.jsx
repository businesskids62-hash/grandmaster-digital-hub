import { useState } from 'react';
import { FileText, Printer, Plus, Trash2, Mail, Phone, MapPin, Globe, Sparkles } from 'lucide-react';
import { useLanguage } from '../hooks/useLanguage';

export default function ResumeBuilder() {
  const { isRtl } = useLanguage();
  const [activeTab, setActiveTab] = useState('both'); // 'edit', 'preview', 'both'

  const [resume, setResume] = useState({
    fullName: 'Hamza Khan',
    jobTitle: 'Senior Full Stack Software Architect',
    email: 'hamza.khan@grandmasterhub.local',
    phone: '+92 300 1234567',
    location: 'Lahore, Pakistan',
    website: 'https://hamzakhan.dev',
    summary: 'Seasoned full-stack developer and AI systems architect with 7+ years of experience designing scalable web applications, real-time distributed microservices, and AI-driven automation workflows.',
    experiences: [
      {
        id: '1',
        title: 'Lead Software Engineer',
        company: 'Vanguard Tech Labs',
        period: '2022 - Present',
        description: 'Led a team of 8 engineers architecting mission-critical React/Node.js web platforms with 99.98% uptime. Spearheaded migration to modern microfrontends and high-speed build pipelines.'
      },
      {
        id: '2',
        title: 'Full Stack Developer',
        company: 'Nexus Digital Studio',
        period: '2019 - 2022',
        description: 'Developed 30+ responsive web applications, payment gateways, and client tools. Reduced asset load times by 40% through canvas compression and performance auditing.'
      }
    ],
    education: [
      {
        id: '1',
        degree: 'BS in Computer Science',
        institution: 'National University of Computer & Emerging Sciences (FAST)',
        year: '2015 - 2019'
      }
    ],
    skills: 'React, Node.js, TypeScript, Vite, Tailwind CSS, Python, Docker, PostgreSQL, REST APIs, Git, UI/UX'
  });

  const handlePrint = () => {
    window.print();
  };

  const addExperience = () => {
    setResume(prev => ({
      ...prev,
      experiences: [
        ...prev.experiences,
        { id: Date.now().toString(), title: 'Job Title', company: 'Company Name', period: '2024 - Present', description: 'Key responsibilities and achievements.' }
      ]
    }));
  };

  const removeExperience = (id) => {
    setResume(prev => ({
      ...prev,
      experiences: prev.experiences.filter(exp => exp.id !== id)
    }));
  };

  const addEducation = () => {
    setResume(prev => ({
      ...prev,
      education: [
        ...prev.education,
        { id: Date.now().toString(), degree: 'Degree / Certification', institution: 'University / Institute', year: 'Year' }
      ]
    }));
  };

  const removeEducation = (id) => {
    setResume(prev => ({
      ...prev,
      education: prev.education.filter(edu => edu.id !== id)
    }));
  };

  const skillList = resume.skills.split(',').map(s => s.trim()).filter(Boolean);

  return (
    <div className="max-w-6xl mx-auto space-y-6">
      {/* Top Controller (No Print) */}
      <div className="p-4 sm:p-6 bg-white dark:bg-brand-navy-800 rounded-3xl shadow-xl border border-slate-200 dark:border-brand-navy-700 flex flex-wrap items-center justify-between gap-4 no-print">
        <div className="flex items-center gap-3">
          <div className="p-2.5 bg-blue-500/10 text-blue-500 rounded-2xl">
            <FileText className="w-6 h-6" />
          </div>
          <div>
            <h3 className="font-bold text-lg text-slate-900 dark:text-white">
              {isRtl ? 'ایگزیکٹو ریزیومے بلڈر' : 'Executive Resume & CV Builder'}
            </h3>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              {isRtl ? 'اپنا پیشہ ورانہ سی وی تیار کریں اور فوری طور پر پی ڈی ایف ڈاؤن لوڈ کریں' : 'Live reactive CV editing with print-perfect executive stylesheet'}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-3">
          <div className="hidden sm:flex rounded-xl p-1 bg-slate-100 dark:bg-brand-navy-900 text-xs font-semibold">
            <button
              onClick={() => setActiveTab('both')}
              className={`px-3 py-1.5 rounded-lg transition ${activeTab === 'both' ? 'bg-white dark:bg-brand-navy-700 text-brand-gold-500 shadow-sm' : 'text-slate-500'}`}
            >
              Side-by-Side
            </button>
            <button
              onClick={() => setActiveTab('edit')}
              className={`px-3 py-1.5 rounded-lg transition ${activeTab === 'edit' ? 'bg-white dark:bg-brand-navy-700 text-brand-gold-500 shadow-sm' : 'text-slate-500'}`}
            >
              Editor Only
            </button>
            <button
              onClick={() => setActiveTab('preview')}
              className={`px-3 py-1.5 rounded-lg transition ${activeTab === 'preview' ? 'bg-white dark:bg-brand-navy-700 text-brand-gold-500 shadow-sm' : 'text-slate-500'}`}
            >
              Preview Only
            </button>
          </div>

          <button
            type="button"
            onClick={handlePrint}
            className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl font-bold text-xs uppercase tracking-wider bg-gradient-to-r from-brand-gold-500 to-amber-500 hover:from-brand-gold-400 hover:to-amber-400 text-brand-navy-900 shadow-md transition"
          >
            <Printer className="w-4 h-4" />
            <span>{isRtl ? 'سی وی پرنٹ / محفوظ کریں' : 'Print / Save PDF'}</span>
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">
        {/* Editor Form Column */}
        {(activeTab === 'edit' || activeTab === 'both') && (
          <div className={`${activeTab === 'both' ? 'lg:col-span-5' : 'lg:col-span-12'} space-y-6 no-print`}>
            {/* Personal Details */}
            <div className="p-5 bg-white dark:bg-brand-navy-800 rounded-3xl border border-slate-200 dark:border-brand-navy-700 space-y-3">
              <h4 className="text-xs font-bold uppercase tracking-wider text-slate-400">
                Personal Information
              </h4>
              <div>
                <label className="text-[11px] font-medium text-slate-500 block">Full Name</label>
                <input
                  type="text"
                  value={resume.fullName}
                  onChange={(e) => setResume({ ...resume, fullName: e.target.value })}
                  className="w-full text-xs px-3 py-2 rounded-lg border border-slate-300 dark:border-brand-navy-700 bg-white dark:bg-brand-navy-900 text-slate-900 dark:text-white"
                />
              </div>
              <div>
                <label className="text-[11px] font-medium text-slate-500 block">Professional Title</label>
                <input
                  type="text"
                  value={resume.jobTitle}
                  onChange={(e) => setResume({ ...resume, jobTitle: e.target.value })}
                  className="w-full text-xs px-3 py-2 rounded-lg border border-slate-300 dark:border-brand-navy-700 bg-white dark:bg-brand-navy-900 text-slate-900 dark:text-white"
                />
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="text-[11px] font-medium text-slate-500 block">Email</label>
                  <input
                    type="email"
                    value={resume.email}
                    onChange={(e) => setResume({ ...resume, email: e.target.value })}
                    className="w-full text-xs px-3 py-2 rounded-lg border border-slate-300 dark:border-brand-navy-700 bg-white dark:bg-brand-navy-900 text-slate-900 dark:text-white"
                  />
                </div>
                <div>
                  <label className="text-[11px] font-medium text-slate-500 block">Phone</label>
                  <input
                    type="text"
                    value={resume.phone}
                    onChange={(e) => setResume({ ...resume, phone: e.target.value })}
                    className="w-full text-xs px-3 py-2 rounded-lg border border-slate-300 dark:border-brand-navy-700 bg-white dark:bg-brand-navy-900 text-slate-900 dark:text-white"
                  />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="text-[11px] font-medium text-slate-500 block">Location</label>
                  <input
                    type="text"
                    value={resume.location}
                    onChange={(e) => setResume({ ...resume, location: e.target.value })}
                    className="w-full text-xs px-3 py-2 rounded-lg border border-slate-300 dark:border-brand-navy-700 bg-white dark:bg-brand-navy-900 text-slate-900 dark:text-white"
                  />
                </div>
                <div>
                  <label className="text-[11px] font-medium text-slate-500 block">Website</label>
                  <input
                    type="text"
                    value={resume.website}
                    onChange={(e) => setResume({ ...resume, website: e.target.value })}
                    className="w-full text-xs px-3 py-2 rounded-lg border border-slate-300 dark:border-brand-navy-700 bg-white dark:bg-brand-navy-900 text-slate-900 dark:text-white"
                  />
                </div>
              </div>
              <div>
                <label className="text-[11px] font-medium text-slate-500 block">Professional Summary</label>
                <textarea
                  rows={3}
                  value={resume.summary}
                  onChange={(e) => setResume({ ...resume, summary: e.target.value })}
                  className="w-full text-xs p-2.5 rounded-lg border border-slate-300 dark:border-brand-navy-700 bg-white dark:bg-brand-navy-900 text-slate-900 dark:text-white"
                />
              </div>
            </div>

            {/* Experience Section */}
            <div className="p-5 bg-white dark:bg-brand-navy-800 rounded-3xl border border-slate-200 dark:border-brand-navy-700 space-y-4">
              <div className="flex items-center justify-between">
                <h4 className="text-xs font-bold uppercase tracking-wider text-slate-400">
                  Work Experience
                </h4>
                <button
                  type="button"
                  onClick={addExperience}
                  className="text-xs text-brand-gold-500 hover:underline flex items-center gap-1 font-semibold"
                >
                  <Plus className="w-3.5 h-3.5" />
                  <span>Add Role</span>
                </button>
              </div>

              {resume.experiences.map((exp, idx) => (
                <div key={exp.id} className="p-3 bg-slate-50 dark:bg-brand-navy-900/40 rounded-xl space-y-2 border border-slate-200 dark:border-brand-navy-700">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-bold text-slate-700 dark:text-slate-300">Position #{idx + 1}</span>
                    <button
                      type="button"
                      onClick={() => removeExperience(exp.id)}
                      className="text-slate-400 hover:text-red-500"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <input
                      type="text"
                      placeholder="Title"
                      value={exp.title}
                      onChange={(e) => {
                        const updated = [...resume.experiences];
                        updated[idx].title = e.target.value;
                        setResume({ ...resume, experiences: updated });
                      }}
                      className="text-xs px-2.5 py-1.5 rounded-lg border border-slate-300 dark:border-brand-navy-700 bg-white dark:bg-brand-navy-900 text-slate-900 dark:text-white"
                    />
                    <input
                      type="text"
                      placeholder="Company"
                      value={exp.company}
                      onChange={(e) => {
                        const updated = [...resume.experiences];
                        updated[idx].company = e.target.value;
                        setResume({ ...resume, experiences: updated });
                      }}
                      className="text-xs px-2.5 py-1.5 rounded-lg border border-slate-300 dark:border-brand-navy-700 bg-white dark:bg-brand-navy-900 text-slate-900 dark:text-white"
                    />
                  </div>
                  <input
                    type="text"
                    placeholder="Period (e.g., 2021 - Present)"
                    value={exp.period}
                    onChange={(e) => {
                      const updated = [...resume.experiences];
                      updated[idx].period = e.target.value;
                      setResume({ ...resume, experiences: updated });
                    }}
                    className="w-full text-xs px-2.5 py-1.5 rounded-lg border border-slate-300 dark:border-brand-navy-700 bg-white dark:bg-brand-navy-900 text-slate-900 dark:text-white"
                  />
                  <textarea
                    rows={2}
                    placeholder="Responsibilities & Accomplishments"
                    value={exp.description}
                    onChange={(e) => {
                      const updated = [...resume.experiences];
                      updated[idx].description = e.target.value;
                      setResume({ ...resume, experiences: updated });
                    }}
                    className="w-full text-xs p-2 rounded-lg border border-slate-300 dark:border-brand-navy-700 bg-white dark:bg-brand-navy-900 text-slate-900 dark:text-white"
                  />
                </div>
              ))}
            </div>

            {/* Skills & Education */}
            <div className="p-5 bg-white dark:bg-brand-navy-800 rounded-3xl border border-slate-200 dark:border-brand-navy-700 space-y-3">
              <h4 className="text-xs font-bold uppercase tracking-wider text-slate-400">
                Skills & Technologies
              </h4>
              <input
                type="text"
                placeholder="Comma separated: React, Python, Docker, ..."
                value={resume.skills}
                onChange={(e) => setResume({ ...resume, skills: e.target.value })}
                className="w-full text-xs px-3 py-2 rounded-lg border border-slate-300 dark:border-brand-navy-700 bg-white dark:bg-brand-navy-900 text-slate-900 dark:text-white"
              />
            </div>
          </div>
        )}

        {/* Live Resume Sheet (Printable) */}
        {(activeTab === 'preview' || activeTab === 'both') && (
          <div className={`${activeTab === 'both' ? 'lg:col-span-7' : 'lg:col-span-12'} bg-white text-slate-900 p-8 sm:p-12 rounded-3xl shadow-2xl border border-slate-200 print:shadow-none print:border-none print:p-0 print:m-0`}>
            {/* Header */}
            <div className="border-b-2 border-brand-navy-900 pb-6 mb-6">
              <h1 className="text-3xl font-black tracking-tight text-brand-navy-900 uppercase">
                {resume.fullName}
              </h1>
              <p className="text-base font-bold text-brand-gold-600 mt-0.5 tracking-wide">
                {resume.jobTitle}
              </p>

              {/* Contact Pill Bar */}
              <div className="flex flex-wrap items-center gap-4 text-xs text-slate-600 mt-4">
                {resume.email && (
                  <span className="flex items-center gap-1.5">
                    <Mail className="w-3.5 h-3.5 text-slate-400" />
                    <span>{resume.email}</span>
                  </span>
                )}
                {resume.phone && (
                  <span className="flex items-center gap-1.5">
                    <Phone className="w-3.5 h-3.5 text-slate-400" />
                    <span>{resume.phone}</span>
                  </span>
                )}
                {resume.location && (
                  <span className="flex items-center gap-1.5">
                    <MapPin className="w-3.5 h-3.5 text-slate-400" />
                    <span>{resume.location}</span>
                  </span>
                )}
                {resume.website && (
                  <span className="flex items-center gap-1.5">
                    <Globe className="w-3.5 h-3.5 text-slate-400" />
                    <span>{resume.website}</span>
                  </span>
                )}
              </div>
            </div>

            {/* Summary */}
            {resume.summary && (
              <div className="mb-6">
                <h3 className="text-xs font-black uppercase tracking-widest text-slate-400 mb-2">
                  Professional Profile
                </h3>
                <p className="text-xs text-slate-700 leading-relaxed">
                  {resume.summary}
                </p>
              </div>
            )}

            {/* Experience */}
            <div className="mb-6">
              <h3 className="text-xs font-black uppercase tracking-widest text-slate-400 mb-3">
                Experience
              </h3>
              <div className="space-y-4">
                {resume.experiences.map((exp) => (
                  <div key={exp.id} className="text-xs">
                    <div className="flex justify-between items-baseline">
                      <span className="font-extrabold text-slate-900 text-sm">
                        {exp.title}
                      </span>
                      <span className="text-[11px] font-mono text-slate-500">
                        {exp.period}
                      </span>
                    </div>
                    <span className="font-semibold text-brand-gold-600 block mb-1">
                      {exp.company}
                    </span>
                    <p className="text-slate-600 leading-relaxed whitespace-pre-line">
                      {exp.description}
                    </p>
                  </div>
                ))}
              </div>
            </div>

            {/* Education */}
            <div className="mb-6">
              <h3 className="text-xs font-black uppercase tracking-widest text-slate-400 mb-3">
                Education
              </h3>
              <div className="space-y-2">
                {resume.education.map((edu) => (
                  <div key={edu.id} className="text-xs flex justify-between items-baseline">
                    <div>
                      <span className="font-bold text-slate-900 block">{edu.degree}</span>
                      <span className="text-slate-600">{edu.institution}</span>
                    </div>
                    <span className="text-[11px] font-mono text-slate-500">{edu.year}</span>
                  </div>
                ))}
              </div>
            </div>

            {/* Skills */}
            <div>
              <h3 className="text-xs font-black uppercase tracking-widest text-slate-400 mb-2.5">
                Core Competencies & Skills
              </h3>
              <div className="flex flex-wrap gap-1.5">
                {skillList.map((skill, i) => (
                  <span
                    key={i}
                    className="px-2.5 py-1 rounded bg-slate-100 text-slate-800 text-[11px] font-medium print:border print:border-slate-300"
                  >
                    {skill}
                  </span>
                ))}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
