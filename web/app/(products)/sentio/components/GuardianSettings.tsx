'use client';

import { useState, useEffect } from 'react';
import { getMyGuardians, addMyGuardian, deleteMyGuardian, MyGuardian } from '@/lib/api/adh';
import { XMarkIcon, PlusIcon, TrashIcon, ShieldCheckIcon } from '@heroicons/react/24/solid';

interface GuardianSettingsProps {
    isOpen: boolean;
    onClose: () => void;
}

const emptyForm = { name: '', phone: '', email: '', dingtalk: '', wechat: '' };

export function GuardianSettings({ isOpen, onClose }: GuardianSettingsProps) {
    const [guardians, setGuardians] = useState<MyGuardian[]>([]);
    const [showAdd, setShowAdd] = useState(false);
    const [form, setForm] = useState(emptyForm);
    const [loading, setLoading] = useState(false);
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState('');

    useEffect(() => {
        if (isOpen) {
            loadGuardians();
            setShowAdd(false);
            setForm(emptyForm);
            setError('');
        }
    }, [isOpen]);

    const loadGuardians = async () => {
        setLoading(true);
        try {
            const list = await getMyGuardians();
            setGuardians(list);
        } catch (e: any) {
            setError(e.message || '加载失败');
        } finally {
            setLoading(false);
        }
    };

    const handleAdd = async () => {
        if (!form.name.trim()) {
            setError('请填写监护人姓名');
            return;
        }
        if (!form.phone && !form.email && !form.dingtalk && !form.wechat) {
            setError('请至少填写一种联系方式（手机号、邮箱、钉钉或微信）');
            return;
        }
        setError('');
        setSaving(true);
        try {
            await addMyGuardian({
                name: form.name.trim(),
                phone: form.phone.trim() || undefined,
                email: form.email.trim() || undefined,
                dingtalk: form.dingtalk.trim() || undefined,
                wechat: form.wechat.trim() || undefined,
            });
            setForm(emptyForm);
            setShowAdd(false);
            await loadGuardians();
        } catch (e: any) {
            setError(e.message || '添加失败');
        } finally {
            setSaving(false);
        }
    };

    const handleDelete = async (id: number, name: string) => {
        if (!confirm(`确定删除监护人「${name}」？`)) return;
        try {
            await deleteMyGuardian(id);
            await loadGuardians();
        } catch (e: any) {
            setError(e.message || '删除失败');
        }
    };

    if (!isOpen) return null;

    return (
        <div
            className="fixed inset-0 z-50 flex items-center justify-center"
            style={{ background: 'rgba(0,0,0,0.35)' }}
            onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
        >
            <div
                className="relative rounded-2xl shadow-2xl w-full max-w-[480px] mx-4 flex flex-col overflow-hidden"
                style={{
                    background: 'rgba(255,255,255,0.88)',
                    backdropFilter: 'blur(24px)',
                    WebkitBackdropFilter: 'blur(24px)',
                    maxHeight: '85vh',
                    border: '1px solid rgba(255,255,255,0.6)',
                }}
            >
                {/* Header */}
                <div className="flex items-center justify-between px-6 pt-6 pb-4">
                    <div className="flex items-center gap-2">
                        <ShieldCheckIcon className="w-5 h-5 text-purple-500" />
                        <h2 className="text-lg font-bold text-gray-800">我的监护人</h2>
                    </div>
                    <button
                        onClick={onClose}
                        className="w-8 h-8 rounded-full flex items-center justify-center hover:bg-gray-100 transition-colors"
                    >
                        <XMarkIcon className="w-4 h-4 text-gray-700" />
                    </button>
                </div>

                {/* Description */}
                <p className="text-sm text-gray-700 px-6 pb-4 leading-relaxed">
                    当系统检测到心理危机时，将通过监护人配置的联系方式发送紧急通知。
                </p>

                {/* Error */}
                {error && (
                    <div className="mx-6 mb-3 px-3 py-2 rounded-lg bg-red-50 border border-red-200 text-sm text-red-600">
                        {error}
                    </div>
                )}

                {/* List */}
                <div className="flex-1 overflow-y-auto px-6">
                    {loading ? (
                        <div className="py-8 text-center text-gray-700 text-sm">加载中...</div>
                    ) : guardians.length === 0 && !showAdd ? (
                        <div className="py-10 text-center">
                            <ShieldCheckIcon className="w-10 h-10 text-purple-200 mx-auto mb-2" />
                            <p className="text-gray-700 text-sm">暂无监护人，请添加</p>
                        </div>
                    ) : (
                        <div className="space-y-2">
                            {guardians.map((g) => {
                                const contacts = [g.phone, g.email, g.dingtalk && `钉钉: ${g.dingtalk}`, g.wechat && `微信: ${g.wechat}`].filter(Boolean);
                                return (
                                    <div
                                        key={g.id}
                                        className="flex items-center justify-between rounded-xl px-4 py-3"
                                        style={{ background: 'rgba(139,92,246,0.06)', border: '1px solid rgba(139,92,246,0.15)' }}
                                    >
                                        <div className="flex-1 min-w-0">
                                            <div className="font-medium text-gray-800 text-sm">{g.name}</div>
                                            <div className="text-xs text-gray-700 mt-0.5 truncate">
                                                {contacts.join(' · ')}
                                            </div>
                                        </div>
                                        <button
                                            onClick={() => handleDelete(g.id, g.name)}
                                            className="ml-3 w-7 h-7 flex items-center justify-center rounded-lg hover:bg-red-50 transition-colors flex-shrink-0"
                                            title="删除"
                                        >
                                            <TrashIcon className="w-4 h-4 text-red-400" />
                                        </button>
                                    </div>
                                );
                            })}
                        </div>
                    )}

                    {/* Add Form */}
                    {showAdd && (
                        <div
                            className="mt-3 rounded-xl p-4 space-y-3"
                            style={{ background: 'rgba(255,255,255,0.7)', border: '1px solid rgba(139,92,246,0.2)' }}
                        >
                            <p className="text-xs font-medium text-purple-600 mb-1">添加监护人</p>
                            <input
                                placeholder="姓名 *"
                                value={form.name}
                                onChange={(e) => setForm({ ...form, name: e.target.value })}
                                className="w-full px-3 py-2 text-sm rounded-lg outline-none transition-all"
                                style={{ background: 'rgba(255,255,255,0.8)', border: '1px solid #e5e7eb' }}
                                onFocus={(e) => (e.target.style.borderColor = '#a78bfa')}
                                onBlur={(e) => (e.target.style.borderColor = '#e5e7eb')}
                            />
                            <input
                                placeholder="手机号"
                                value={form.phone}
                                onChange={(e) => setForm({ ...form, phone: e.target.value })}
                                className="w-full px-3 py-2 text-sm rounded-lg outline-none transition-all"
                                style={{ background: 'rgba(255,255,255,0.8)', border: '1px solid #e5e7eb' }}
                                onFocus={(e) => (e.target.style.borderColor = '#a78bfa')}
                                onBlur={(e) => (e.target.style.borderColor = '#e5e7eb')}
                            />
                            <input
                                placeholder="邮箱"
                                value={form.email}
                                onChange={(e) => setForm({ ...form, email: e.target.value })}
                                className="w-full px-3 py-2 text-sm rounded-lg outline-none transition-all"
                                style={{ background: 'rgba(255,255,255,0.8)', border: '1px solid #e5e7eb' }}
                                onFocus={(e) => (e.target.style.borderColor = '#a78bfa')}
                                onBlur={(e) => (e.target.style.borderColor = '#e5e7eb')}
                            />
                            <input
                                placeholder="钉钉"
                                value={form.dingtalk}
                                onChange={(e) => setForm({ ...form, dingtalk: e.target.value })}
                                className="w-full px-3 py-2 text-sm rounded-lg outline-none transition-all"
                                style={{ background: 'rgba(255,255,255,0.8)', border: '1px solid #e5e7eb' }}
                                onFocus={(e) => (e.target.style.borderColor = '#a78bfa')}
                                onBlur={(e) => (e.target.style.borderColor = '#e5e7eb')}
                            />
                            <input
                                placeholder="微信"
                                value={form.wechat}
                                onChange={(e) => setForm({ ...form, wechat: e.target.value })}
                                className="w-full px-3 py-2 text-sm rounded-lg outline-none transition-all"
                                style={{ background: 'rgba(255,255,255,0.8)', border: '1px solid #e5e7eb' }}
                                onFocus={(e) => (e.target.style.borderColor = '#a78bfa')}
                                onBlur={(e) => (e.target.style.borderColor = '#e5e7eb')}
                            />
                            <div className="flex gap-2 pt-1">
                                <button
                                    onClick={handleAdd}
                                    disabled={saving}
                                    className="flex-1 py-2 text-sm font-medium text-white rounded-lg transition-opacity disabled:opacity-60"
                                    style={{ background: 'linear-gradient(135deg, #8b5cf6, #7c3aed)' }}
                                >
                                    {saving ? '保存中...' : '保存'}
                                </button>
                                <button
                                    onClick={() => { setShowAdd(false); setForm(emptyForm); setError(''); }}
                                    className="flex-1 py-2 text-sm font-medium text-gray-600 rounded-lg border border-gray-200 hover:bg-gray-50 transition-colors"
                                >
                                    取消
                                </button>
                            </div>
                        </div>
                    )}
                </div>

                {/* Footer: Add button */}
                {!showAdd && (
                    <div className="px-6 py-4">
                        <button
                            onClick={() => { setShowAdd(true); setError(''); }}
                            className="w-full py-2.5 text-sm font-medium text-purple-600 rounded-xl flex items-center justify-center gap-1.5 transition-colors hover:bg-purple-50"
                            style={{ border: '2px dashed rgba(139,92,246,0.4)' }}
                        >
                            <PlusIcon className="w-4 h-4" />
                            添加监护人
                        </button>
                    </div>
                )}
            </div>
        </div>
    );
}

