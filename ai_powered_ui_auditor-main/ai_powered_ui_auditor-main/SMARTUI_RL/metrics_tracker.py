import json

class AuditMetrics:
    def __init__(self):
        self.runs = []
    
    def record_run(self, audit_report, user_feedbacks):
        """
        Tracks each audit run
        
        user_feedbacks: list of tuples [(rule_name, feedback), ...]
        feedback: 1 (accepted) or -1 (rejected)
        """
        total_violations = audit_report["summary"]["violations"]
        accepted = sum(1 for _, fb in user_feedbacks if fb == 1)
        rejected = sum(1 for _, fb in user_feedbacks if fb == -1)
        
        run_data = {
            "run_number": len(self.runs) + 1,
            "total_violations_detected": total_violations,
            "accepted_by_user": accepted,
            "rejected_by_user": rejected,
            "false_positive_rate": round((rejected / total_violations * 100) if total_violations > 0 else 0, 2),
            "accuracy": round((accepted / total_violations * 100) if total_violations > 0 else 0, 2)
        }
        
        self.runs.append(run_data)
        return run_data
    
    def get_improvement_metrics(self):
        """
        Shows learning improvement over time
        """
        if len(self.runs) < 2:
            return {"message": "Need at least 2 runs to calculate improvement"}
        
        first_run = self.runs[0]
        latest_run = self.runs[-1]
        
        fp_reduction = first_run["false_positive_rate"] - latest_run["false_positive_rate"]
        accuracy_gain = latest_run["accuracy"] - first_run["accuracy"]
        
        return {
            "initial_accuracy": first_run["accuracy"],
            "current_accuracy": latest_run["accuracy"],
            "accuracy_improvement": round(accuracy_gain, 2),
            "initial_fp_rate": first_run["false_positive_rate"],
            "current_fp_rate": latest_run["false_positive_rate"],
            "fp_reduction": round(fp_reduction, 2),
            "total_runs": len(self.runs)
        }
    
    def get_all_runs(self):
        """Returns all recorded runs"""
        return self.runs
    
    def save_metrics(self, filename="metrics_history.json"):
        """Save metrics to file"""
        with open(filename, 'w') as f:
            json.dump({
                "runs": self.runs,
                "summary": self.get_improvement_metrics() if len(self.runs) > 1 else {}
            }, f, indent=4)
        print(f" Metrics saved to {filename}")


def calculate_rl_accuracy(learner):
    """
    Measures how well RL learns from feedback
    """
    total_rules = len(learner.weights)
    
    if total_rules == 0:
        return {
            "total_rules_trained": 0,
            "learned_to_ignore": 0,
            "learned_to_enforce": 0,
            "still_neutral": 0,
            "learning_rate": 0
        }
    
    # Rules the AI learned to ignore (weight < 0.4)
    ignored_rules = sum(1 for w in learner.weights.values() if w < 0.4)
    
    # Rules the AI strengthened (weight > 1.2)
    strengthened_rules = sum(1 for w in learner.weights.values() if w > 1.2)
    
    # Rules still at default (0.9 < weight < 1.1)
    neutral_rules = sum(1 for w in learner.weights.values() if 0.9 <= w <= 1.1)
    
    return {
        "total_rules_trained": total_rules,
        "learned_to_ignore": ignored_rules,
        "learned_to_enforce": strengthened_rules,
        "still_neutral": neutral_rules,
        "learning_rate": round((ignored_rules + strengthened_rules) / total_rules * 100, 2)
    }