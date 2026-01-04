import type { ReactNode } from 'react';

export function QuickStart(): ReactNode {
	return (
		<section className="quickstart-section">
			<h2 className="section-title">Up and running in 60 seconds</h2>
			<div className="quickstart-steps">
				<div className="quickstart-step">
					<span className="step-number">1</span>
					<code className="step-code">git clone https://github.com/jeffgreendesign/textrawl.git</code>
					<p className="step-description">Clone the repo</p>
				</div>
				<div className="quickstart-step">
					<span className="step-number">2</span>
					<code className="step-code">npm run setup</code>
					<p className="step-description">Configure credentials</p>
				</div>
				<div className="quickstart-step">
					<span className="step-number">3</span>
					<code className="step-code">npm run dev</code>
					<p className="step-description">Start the MCP server</p>
				</div>
			</div>
		</section>
	);
}
