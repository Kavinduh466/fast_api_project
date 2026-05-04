import pandas as pd
import os

class RuleEngine:
    def __init__(self, excel_file="UI_RULE_SETS.xlsx"):
        self.excel_file = excel_file
        self.current_rules = {}
        # These act as the "Safety Net" if  Excel file has no numbers
        self.defaults = {
            "min_button_height": 44,
            "min_field_height": 40,
            "max_misalignment": 4
        }
        self.text_rules = [] #  will store the text rules (like HIPAA) here
        # Populated in load_rules — rows auditor_service._check_metric_rules understands
        self.measurable_rules: list = []

    def _build_measurable_rules(self):
        """
        Derive metric rows for SMARTUI_RL/auditor_service._check_metric_rules from
        parsed current_rules (Excel keyword scan). If Excel mangles a value (e.g. 3px),
        fall back to defaults for that key.
        """
        cr = self.current_rules or {}
        d = self.defaults

        def px(key: str) -> float:
            v = int(cr.get(key, d.get(key, 44)))
            if v < 24:
                return float(d.get(key, 44 if key == "min_button_height" else 40))
            return float(v)

        rules = [
            {
                "rule_id": "min_button_height",
                "name": "Minimum button / touch target height",
                "metric_key": "height",
                "metric_value": px("min_button_height"),
                "element_types": ["button", "bbu", "buttons"],
                "comparator": "lt",
            },
            {
                "rule_id": "min_field_height",
                "name": "Minimum input / field height",
                "metric_key": "height",
                "metric_value": px("min_field_height"),
                "element_types": ["input", "field", "label", "lable"],
                "comparator": "lt",
            },
            {
                "rule_id": "contrast_ratio",
                "name": "Minimum contrast (WCAG-style)",
                "metric_key": "contrast",
                "metric_value": 3.0,
                "element_types": ["button", "input", "field", "label", "text", "link"],
                "comparator": "lt",
            },
        ]
        self.measurable_rules = rules

    def get_rules_for_llm(self, max_rules: int = 8) -> list:
        """Text / policy rules for TinyLlama evaluation in auditor_service."""
        out = []
        for i, tr in enumerate(self.text_rules[: max_rules if max_rules else 8]):
            name = str(tr.get("name", f"rule_{i}")).strip()
            desc = str(tr.get("description", "")).strip()
            rid = (
                name.lower()
                .replace(" ", "_")
                .replace("&", "and")
                .replace("/", "_")
            )
            out.append({"rule_id": rid or f"text_rule_{i}", "name": name, "description": desc})
        return out

    def load_rules(self, profile_name):
        sheet_map = {
            "apple": "Apple HIG", "ios": "Apple HIG",
            "google": "Google Material Design", "material": "Google Material Design",
            "android": "Android",
            "microsoft": "Microsoft Fluent", "fluent": "Microsoft Fluent",
            "healthcare": "Healthcare",
            "ecommerce": "E-commerce",
            "gaming": "Gaming",
            "enterprise": "Enterprise", "b2b": "Enterprise",
            "web": "Web Standards",
            "universal": "Universal Rules",
            "all": "All Rules",
            "overview": "Overview"
        }
        
        target_sheet = sheet_map.get(profile_name.lower(), "Universal Rules")
        print(f" Opening '{self.excel_file}' -> Sheet: '{target_sheet}'...")
        
        try:
            # Load sheet without assuming headers (header=None)
            df = pd.read_excel(self.excel_file, sheet_name=target_sheet, header=None)
            
            self.current_rules = {}
            self.text_rules = []
            
            for index, row in df.iterrows():
                # Skip the first row if it seems to be headers like "Rule ID", "Rule Name"
                if index == 0 and str(row.values[0]).lower().strip() == "rule id":
                    continue
                
                # Convert row to a single string to search for keywords easily
                row_str = str(row.values).lower()
                key = None
                # Capture rules that aren't clearly math-based but are descriptive
                if not key:
                    # If it's not a math rule, it's likely a policy/text rule
                    # We look for rows that have a description in the 3rd column (index 2)
                    if len(row) > 2 and pd.notna(row[2]) and str(row[2]).strip():
                        # Store both Name (row[1]) and Description (row[2]) in a dictionary
                        rule_name = str(row[1]).strip() if pd.notna(row[1]) else f"Rule_{index}"
                        self.text_rules.append({
                            "name": rule_name,
                            "description": str(row[2]).strip()
                        })

                # --- B. CAPTURE MATH RULES (For the Python Judge) ---
                key = None
                if "button" in row_str and ("height" in row_str or "size" in row_str):
                    key = "min_button_height"
                elif ("field" in row_str or "input" in row_str) and "height" in row_str:
                    key = "min_field_height"
                elif "align" in row_str:
                    key = "max_misalignment"
                
                if not key:
                    continue

                # Hunt for the Value (Find the first number in the row)
                for cell in row:
                    val_str = str(cell)
                    # Extract digits (e.g., "44px" -> "44")
                    digits = ''.join(filter(str.isdigit, val_str))
                    
                    if digits and int(digits) > 0:
                        self.current_rules[key] = int(digits)
                        break # Stop after finding the first number
                
            # Final Report
            if self.current_rules:
                print(f" Loaded Math Rules: {self.current_rules}")
            else:
                print(f" No pixel dimensions found. Using Defaults ({self.defaults['min_button_height']}px).")
                print("   (This is normal if your Excel sheet only contains text policies like HIPAA)")
                self.current_rules = self.defaults

            self._build_measurable_rules()

        except Exception as e:
            print(f" Error: {e}")
            self.current_rules = self.defaults
            # Avoid reusing text_rules from a previous successful profile load
            self.text_rules = []
            self._build_measurable_rules()

    def get(self, key):
        return self.current_rules.get(key, self.defaults.get(key))