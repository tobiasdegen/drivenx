import { useEffect, useRef } from 'react';
import { attributeInfo } from '../../attribute-info';
import { translate, type Locale } from '../../i18n.mts';
import type { DiagnosticEvidence, DiagnosticLevel } from '../../../shared/diagnosis-model.mjs';
import { attributeFindingReason } from '../../attribute-evidence-text';
import type { SmartAttribute } from '../../smart-attributes';

/** Explanation of one attribute; the table never needs to know dialog layout. */
export default function AttributeDetailsDialog({
  attribute,
  evidence,
  severity,
  locale,
  onClose,
}: {
  attribute: SmartAttribute;
  evidence: DiagnosticEvidence[];
  severity: DiagnosticLevel | null;
  locale: Locale;
  onClose: () => void;
}) {
  const tr = (key: string) => translate(locale, 'smartView', key);
  const info = attributeInfo(attribute.id, attribute.name, locale);
  const closeButton = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    const previous = document.activeElement;
    closeButton.current?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      if (previous instanceof HTMLElement) previous.focus();
    };
  }, [onClose]);
  return (
    <div className="attribute-detail-overlay" onClick={() => onClose()}>
      <section
        className="attribute-detail"
        role="dialog"
        aria-modal="true"
        aria-label={info.label}
        onClick={(e) => e.stopPropagation()}
      >
        <button
          ref={closeButton}
          className="attribute-detail-close"
          onClick={() => onClose()}
          aria-label={tr('attributeClose')}
        >
          ×
        </button>
        <header className="attribute-detail-header">
          <h3>{info.label}</h3>
          <p className="attribute-detail-subtitle mono">
            {attribute.name} {typeof attribute.id === 'number' ? `(ID ${attribute.id})` : ''}
          </p>
        </header>
        <section className={`attribute-detail-evidence is-${severity ?? 'none'}`}>
          <h4>{tr('attributeEvidence')}</h4>
          {severity && <strong>{translate(locale, 'diagnosis', severity)}</strong>}
          {evidence.length ? (
            <ul>
              {evidence.map((item, index) => (
                <li key={`${item.ruleId}-${index}`}>{attributeFindingReason(item, locale)}</li>
              ))}
            </ul>
          ) : (
            <p>{tr('attributeNoEvidence')}</p>
          )}
        </section>
        <section className="attribute-detail-section">
          <h4>{tr('description')}</h4>
          <p>{info.description || tr('attributeNoDescription')}</p>
        </section>
        <section className="attribute-detail-section">
          <h4>{tr('attributeHowToInterpret')}</h4>
          <p>{info.interpretation}</p>
        </section>
        {typeof attribute.id === 'number' && (
          <section className="attribute-detail-section">
            <h4>{tr('attributeInterpretationBasis')}</h4>
            <div className="attribute-normalized-grid">
              <div>
                <span>{tr('attributeNormalizedCurrent')}</span>
                <strong>{attribute.current ?? '–'}</strong>
              </div>
              <div>
                <span>{tr('attributeNormalizedWorst')}</span>
                <strong>{attribute.worst ?? '–'}</strong>
              </div>
              <div>
                <span>{tr('attributeNormalizedThreshold')}</span>
                <strong>{attribute.threshold ?? '–'}</strong>
              </div>
            </div>
            <p>{tr('attributeRawHelp')}</p>
          </section>
        )}
        <section className="attribute-detail-grid">
          <div className="attribute-detail-card">
            <span className="attribute-detail-key">{tr('originalRaw')}</span>
            <strong className="mono">{attribute.raw}</strong>
          </div>
          <div className="attribute-detail-card">
            <span className="attribute-detail-key">{tr('attributeInterpretationBasis')}</span>
            <p>{tr('attributeInterpretationNote')}</p>
          </div>
        </section>
      </section>
    </div>
  );
}
