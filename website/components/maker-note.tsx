import Link from 'next/link';
import type { ReactNode } from 'react';

type MakerNoteProps = {
	title?: string;
	children: ReactNode;
};

export function MakerNote({
	title = 'Why I built this',
	children,
}: MakerNoteProps): ReactNode {
	return (
		<section className="maker-section">
			<div className="maker-note">
				<h2 className="maker-note-title">{title}</h2>
				{children}
				<MakerSignature />
			</div>
		</section>
	);
}

function MakerSignature(): ReactNode {
	return (
		<Link
			href="https://hirejeffgreen.com"
			target="_blank"
			rel="noopener noreferrer"
			className="maker-sig"
		>
			<div className="maker-avatar">JG</div>
			<div className="maker-info">
				<span className="maker-label">Built by</span>
				<span className="maker-name">Jeff Green</span>
				<span className="maker-title">Product Engineer</span>
			</div>
		</Link>
	);
}
