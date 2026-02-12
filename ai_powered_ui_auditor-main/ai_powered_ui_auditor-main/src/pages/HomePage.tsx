import React from 'react';

interface HomePageProps {
    onNavigate: (step: 'upload' | 'element-audit' | 'permissions' | 'ui-enhancer' | 'combined-selection') => void;
}

const HomePage: React.FC<HomePageProps> = ({ onNavigate }) => {
    return (
        <div className="home-page">
            <h1 className="page-heading">Welcome to Smart UI Auditor</h1>


            <div className="feature-grid">
                <div className="feature-card" onClick={() => onNavigate('upload')}>
                    <div className="feature-card__icon">🎨</div>
                    <h3 className="feature-card__title">Rule Base Analyser</h3>
                    <p className="feature-card__desc">
                        Upload Screenshots to analyze UI consistency and violations.
                    </p>
                    <button className="btn btn-primary" style={{ marginTop: 'auto' }}>Start Audit</button>
                </div>

                <div className="feature-card" onClick={() => onNavigate('element-audit')}>
                    <div className="feature-card__icon">🔍</div>
                    <h3 className="feature-card__title">UI Element Auditor</h3>
                    <p className="feature-card__desc">
                        Upload a screenshot to detect and score individual UI elements against expert design patterns.
                    </p>
                    <button className="btn btn-primary" style={{ marginTop: 'auto' }}>Start Element Audit</button>
                </div>



                <div className="feature-card" onClick={() => onNavigate('combined-selection')}>
                    <div className="feature-card__icon">🧩</div>
                    <h3 className="feature-card__title">Combined Analysis</h3>
                    <p className="feature-card__desc">
                        Run rules audit, element scoring, or both — then generate enhanced UI in one flow.
                    </p>
                    <button className="btn btn-primary" style={{ marginTop: 'auto' }}>Start Combined</button>
                </div>

                <div className="feature-card" onClick={() => onNavigate('permissions')}>
                    <div className="feature-card__icon">📹</div>
                    <h3 className="feature-card__title">User Testing</h3>
                    <p className="feature-card__desc">
                        Record user sessions and screen interactions to identify usability issues.
                    </p>
                    <button className="btn btn-primary" style={{ marginTop: 'auto' }}>Start Testing</button>
                </div>
            </div>
        </div>
    );
};

export default HomePage;
