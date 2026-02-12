import { useState, useEffect, useRef } from 'react'
import UploadPage from './pages/UploadPage'
import AnalysisSelection from './pages/AnalysisSelection'
import VioletRulesPage from './pages/VioletRulesPage'
import ElementInteraction from './pages/ElementInteraction'
import CombinedAnalysis from './pages/CombinedAnalysis'
import UserTesting from './pages/UserTesting'
import HomePage from './pages/HomePage'
import ElementAuditPage from './pages/ElementAuditPage'
import UIEnhancerPage from './pages/UIEnhancerPage'

// Navigation steps
type AppStep =
    | 'home'
    | 'ui-enhancer'
    | 'element-audit'
    | 'upload'
    | 'analysis-selection'
    // Option 1: Violet Rules flow
    | 'processing'
    | 'violet-rules'
    | 'violet-accuracy'
    // Option 2: Element Interaction flow
    | 'element-loading'
    | 'element-interaction'
    | 'element-score'
    // Combined Analysis
    | 'combined-selection'
    // After any flow → User Testing
    | 'permissions'
    | 'recording'
    | 'user-analysis'
    | 'user-results'

export default function App() {
    const [step, setStep] = useState<AppStep>('home')
    const [isMenuOpen, setIsMenuOpen] = useState(false)
    const [uploadedFile, setUploadedFile] = useState<string | null>(null)
    const [uploadedImageUrl, setUploadedImageUrl] = useState<string | null>(null)

    const [category, setCategory] = useState<string>('universal')
    const [auditResult, setAuditResult] = useState<any>(null)
    const [elementAuditResult, setElementAuditResult] = useState<any>(null)

    // Handle outside clicks to close the menu
    const menuRef = useRef<HTMLDivElement>(null)

    useEffect(() => {
        const handleClickOutside = (event: MouseEvent) => {
            if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
                setIsMenuOpen(false)
            }
        }

        if (isMenuOpen) {
            document.addEventListener('mousedown', handleClickOutside)
        } else {
            document.removeEventListener('mousedown', handleClickOutside)
        }

        return () => {
            document.removeEventListener('mousedown', handleClickOutside)
        }
    }, [isMenuOpen])

    const handleProcess = async (option: 'rules' | 'elements' | 'all') => {
        switch (option) {
            case 'rules':
                setStep('processing')
                try {
                    if (!uploadedImageUrl) throw new Error("No image uploaded for processing");

                    // 🖼️ Image Upload Flow
                    const blob = await fetch(uploadedImageUrl).then(r => r.blob());
                    const formData = new FormData();
                    formData.append('file', blob, uploadedFile || 'design.png');
                    formData.append('profile', category || 'universal');

                    const response = await fetch('http://localhost:8000/audit/smart', {
                        method: 'POST',
                        body: formData
                    });

                    const data = await response.json()
                    setAuditResult(data)
                    setStep('violet-rules')
                } catch (error) {
                    console.error('Audit failed:', error)
                    setStep('upload')
                    alert('Audit failed. Please ensure the server is running.')
                }
                break
            case 'elements':
                setStep('element-loading')
                setTimeout(() => setStep('element-interaction'), 2500)
                break
        }
    }

    const goToUserTesting = () => setStep('permissions')

    return (
        <div className="app-container">
            {/* Title Bar */}
            <div className="title-bar">


                <div className="title-bar__menu-container" ref={menuRef}>
                    <button
                        className="title-bar__menu-btn"
                        onClick={() => setIsMenuOpen(!isMenuOpen)}
                    >
                        <div className="hamburger">
                            <span></span>
                            <span></span>
                            <span></span>
                        </div>
                    </button>

                    {isMenuOpen && (
                        <div className="menu-dropdown">
                            <button className="menu-item" onClick={() => { setStep('home'); setIsMenuOpen(false); }}>
                                <span className="menu-item__icon">🏠</span> Home
                            </button>
                            <button className="menu-item" onClick={() => { setStep('upload'); setIsMenuOpen(false); }}>
                                <span className="menu-item__icon">🎨</span> AI Audit
                            </button>
                            <button className="menu-item" onClick={() => { setStep('element-audit'); setIsMenuOpen(false); }}>
                                <span className="menu-item__icon">🔍</span> UI Element Auditor
                            </button>
                            <button className="menu-item" onClick={() => { setStep('ui-enhancer'); setIsMenuOpen(false); }}>
                                <span className="menu-item__icon">✨</span> UI Enhancer
                            </button>
                            <button className="menu-item" onClick={() => { setStep('combined-selection'); setIsMenuOpen(false); }}>
                                <span className="menu-item__icon">🧩</span> Combined Analysis
                            </button>
                            <button className="menu-item" onClick={() => { setStep('permissions'); setIsMenuOpen(false); }}>
                                <span className="menu-item__icon">📹</span> User Testing
                            </button>
                            <div className="menu-divider"></div>
                            <button className="menu-item disabled">
                                <span className="menu-item__icon">⚙️</span> Settings
                            </button>
                        </div>
                    )}
                </div>

            </div>

            {/* Main Content */}
            <div className="main-content">
                <div className="page-enter" key={
                    ['permissions', 'recording', 'user-analysis', 'user-results'].includes(step)
                        ? 'user-testing'
                        : step
                }>

                    {/* Page 0: Home */}
                    {step === 'home' && (
                        <HomePage
                            onNavigate={(target) => {
                                // Clear uploaded image when navigating from home to ensure fresh start
                                if (target === 'element-audit') {
                                    setUploadedImageUrl(null);
                                }
                                setStep(target as AppStep);
                            }}
                        />
                    )}

                    {/* UI Element Auditor */}
                    {step === 'element-audit' && (
                        <ElementAuditPage
                            onBack={() => setStep('home')}
                            onNext={(result, imageUrl) => {
                                setElementAuditResult(result)
                                if (imageUrl) setUploadedImageUrl(imageUrl)
                                setStep('ui-enhancer')
                            }}
                            initialImageUrl={uploadedImageUrl}
                        />
                    )}

                    {/* UI Enhancer Page */}
                    {step === 'ui-enhancer' && (
                        <UIEnhancerPage
                            onBack={() => setStep('home')}
                            initialImageUrl={uploadedImageUrl}
                            comp1AuditResult={auditResult}
                            comp2AuditResult={elementAuditResult}
                        />
                    )}

                    {/* Page 1: Upload */}
                    {step === 'upload' && (
                        <UploadPage
                            onBack={() => setStep('home')}
                            onProcess={(data) => {
                                setUploadedFile(data.fileName)
                                setUploadedImageUrl(data.imageUrl || null)
                                setCategory(data.category || 'universal')
                                // Directly trigger the rules processing
                                handleProcess('rules')
                            }}
                        />
                    )}

                    {/* Page 2: Analysis Selection */}
                    {step === 'analysis-selection' && (
                        <AnalysisSelection
                            uploadedFileName={uploadedFile}
                            uploadedImageUrl={uploadedImageUrl}
                            onStartAnalysis={handleProcess}
                        />
                    )}

                    {/* Option 1: Processing → Violet Rules */}
                    {step === 'processing' && (
                        <div className="spinner-container">
                            <div className="spinner" />
                            <div className="spinner-text">UI is Processing</div>
                        </div>
                    )}

                    {(step === 'violet-rules' || step === 'violet-accuracy') && (
                        <VioletRulesPage
                            step={step}
                            fileName={uploadedFile}
                            auditResult={auditResult}
                            onDone={() => setStep('violet-accuracy')}
                            onNext={() => setStep('element-audit')}
                        />
                    )}

                    {/* Option 2: Element Interaction */}
                    {step === 'element-loading' && (
                        <div className="spinner-container">
                            <div className="spinner" />
                            <div className="spinner-text">Loading<br />Element Interaction</div>
                        </div>
                    )}

                    {(step === 'element-interaction' || step === 'element-score') && (
                        <ElementInteraction
                            step={step}
                            onImportNew={() => setStep('upload')}
                            onElementInteraction={() => { }}
                            onGetScore={() => setStep('element-score')}
                            onNext={goToUserTesting}
                        />
                    )}

                    {/* Combined Analysis (self-contained) */}
                    {step === 'combined-selection' && (
                        <CombinedAnalysis
                            onBack={() => setStep('home')}
                        />
                    )}

                    {/* User Testing (after any flow) */}
                    {(step === 'permissions' || step === 'recording' ||
                        step === 'user-analysis' || step === 'user-results') && (
                            <UserTesting
                                step={step}
                                onBack={() => setStep('home')}
                                onStartRecording={() => setStep('recording')}
                                onStopRecording={() => {
                                    setStep('user-results')
                                }}
                                onAnalyse={() => setStep('user-analysis')}
                                onBackToReview={() => setStep('recording')}
                                onExport={() => alert('Report exported!')}
                                onDiscard={() => setStep('permissions')}
                            />
                        )}
                </div>
            </div>
        </div>
    )
}
